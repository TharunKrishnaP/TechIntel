import os
import asyncio
from typing import Optional, List
from datetime import datetime, timedelta
from fastapi import FastAPI, Query, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .models import (
    TechEvent, Technology, RecommendationRequest,
    RecommendationResponse, ComparisonRequest, ComparisonResponse,
    FeedStats
)
from .database import (
    get_all_events, get_event_by_id, get_events_for_technology,
    get_all_technologies, get_technology_by_id, get_stats, seed_database,
    get_technology_evolution
)
from .services.matcher import (
    match_tools_for_purpose, generate_comparison_matrix, find_alternatives_for_tool
)
from .pipeline.ingestion import sync_all_feeds

app = FastAPI(
    title="TechIntel - Live Technology Intelligence Platform",
    description="Continuously discovers, verifies, summarizes, classifies, and compares technology updates across the web.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

@app.on_event("startup")
async def startup_event():
    seed_database()

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "TechIntel Platform"}

@app.get("/api/stats", response_model=FeedStats)
async def api_get_stats():
    return get_stats()

@app.get("/api/timeline")
async def api_get_timeline(days: int = Query(30, ge=1, le=365)):
    """
    Per-day event counts for the trailing N days, used by the dashboard
    activity heatmap so users can spot busy/quiet days at a glance.
    """
    from .database import get_connection

    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT substr(verified_at, 1, 10) AS day, COUNT(*) AS count
        FROM events
        WHERE substr(verified_at, 1, 10) >= ?
        GROUP BY day
        ORDER BY day ASC
        """,
        (cutoff,)
    )
    rows = {r["day"]: r["count"] for r in cursor.fetchall()}
    conn.close()

    # Fill every day in the window so the heatmap has no gaps.
    series = []
    today = datetime.utcnow().date()
    for offset in range(days - 1, -1, -1):
        d = (today - timedelta(days=offset)).strftime("%Y-%m-%d")
        series.append({"date": d, "count": rows.get(d, 0)})

    return {"days": days, "series": series, "peak": max((p["count"] for p in series), default=0)}

@app.get("/api/feed", response_model=List[TechEvent])
async def api_get_feed(
    category: Optional[str] = Query("All"),
    importance: Optional[str] = Query("All"),
    event_type: Optional[str] = Query("All"),
    search: Optional[str] = Query(None),
    days: Optional[int] = Query(None, ge=1, le=365, description="Only events from the last N days"),
    date_from: Optional[str] = Query(None, description="Explicit start date, YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="Explicit end date, YYYY-MM-DD"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    return get_all_events(
        category=category,
        importance=importance,
        event_type=event_type,
        search=search,
        limit=limit,
        offset=offset,
        date_from=date_from,
        date_to=date_to,
        days=days
    )

@app.get("/api/feed/{event_id}", response_model=TechEvent)
async def api_get_event(event_id: str):
    evt = get_event_by_id(event_id)
    if not evt:
        raise HTTPException(status_code=404, detail="Event not found")
    return evt

@app.get("/api/tools", response_model=List[Technology])
async def api_get_tools(
    category: Optional[str] = Query("All"),
    search: Optional[str] = Query(None)
):
    return get_all_technologies(category=category, search=search)

@app.get("/api/tools/{tool_id}", response_model=Technology)
async def api_get_tool(tool_id: str):
    t = get_technology_by_id(tool_id)
    if not t:
        raise HTTPException(status_code=404, detail="Technology not found")
    return t

@app.get("/api/tools/{tool_id}/events", response_model=List[TechEvent])
async def api_get_tool_events(
    tool_id: str,
    days: Optional[int] = Query(None, ge=1, le=365),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None)
):
    if days and not (date_from or date_to):
        date_from = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M UTC")
    if date_from and len(date_from) == 10:
        date_from = f"{date_from} 00:00 UTC"
    if date_to and len(date_to) == 10:
        date_to = f"{date_to} 23:59 UTC"
    return get_events_for_technology(tool_id, date_from=date_from, date_to=date_to)

@app.get("/api/tools/{tool_id}/evolution")
async def api_get_tool_evolution(tool_id: str, days: int = Query(30, ge=1, le=365)):
    """Full evolution timeline for a technology: version history + event breakdown."""
    result = get_technology_evolution(tool_id, days=days)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

@app.get("/api/tools/{tool_id}/alternatives", response_model=List[Technology])
async def api_get_tool_alternatives(tool_id: str):
    return find_alternatives_for_tool(tool_id)

@app.post("/api/recommend", response_model=RecommendationResponse)
async def api_recommend_tools(req: RecommendationRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    return match_tools_for_purpose(
        query=req.query,
        user_skill_level=req.user_skill_level,
        force_free_only=req.force_free_only
    )

@app.post("/api/compare", response_model=ComparisonResponse)
async def api_compare_tools(req: ComparisonRequest):
    if not req.tool_ids:
        raise HTTPException(status_code=400, detail="tool_ids list cannot be empty")
    return generate_comparison_matrix(req.tool_ids)

@app.post("/api/refresh-feed")
async def api_refresh_feed(background_tasks: BackgroundTasks):
    # Run sync in background or immediately
    new_count = await sync_all_feeds()
    return {"status": "success", "new_events_ingested": new_count}

# Mount static frontend
if os.path.exists(FRONTEND_DIR):
    @app.get("/", include_in_schema=False)
    async def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    # These two need explicit media types. `manifest.json` gets the explicit
    # manifest media type (Chrome accepts application/manifest+json or
    # application/json; GitHub Pages serves .webmanifest as octet-stream, which
    # Chrome refuses — hence the .json extension), and a service worker served
    # with the wrong type is rejected outright.
    @app.get("/manifest.json", include_in_schema=False)
    async def serve_manifest():
        return FileResponse(
            os.path.join(FRONTEND_DIR, "manifest.json"),
            media_type="application/manifest+json",
        )

    @app.get("/sw.js", include_in_schema=False)
    async def serve_service_worker():
        return FileResponse(
            os.path.join(FRONTEND_DIR, "sw.js"),
            media_type="text/javascript",
            headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
        )

    # Serve the whole frontend from the root, not /static, so the app uses
    # relative URLs and therefore also works from a subpath (e.g. GitHub Pages
    # at /TharunKrishnaP/TechIntel) with no path rewriting.
    #
    # This mount is registered last on purpose: FastAPI matches routes in
    # declaration order, so every /api/* route above still wins, and this catch
    # -all only sees paths nothing else claimed.
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
