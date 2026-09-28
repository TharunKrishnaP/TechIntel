import os
import asyncio
from typing import Optional, List
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
    get_all_technologies, get_technology_by_id, get_stats, seed_database
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

@app.get("/api/feed", response_model=List[TechEvent])
async def api_get_feed(
    category: Optional[str] = Query("All"),
    importance: Optional[str] = Query("All"),
    event_type: Optional[str] = Query("All"),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    return get_all_events(
        category=category,
        importance=importance,
        event_type=event_type,
        search=search,
        limit=limit,
        offset=offset
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
async def api_get_tool_events(tool_id: str):
    return get_events_for_technology(tool_id)

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
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
