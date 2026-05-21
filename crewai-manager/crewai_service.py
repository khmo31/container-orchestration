"""
crewai_service.py — CrewAI Manager v3
코드 기반 라우팅 + capability 불일치 시 GitHub 추천
"""

import os, json, subprocess, asyncio, re
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx

app = FastAPI(title="CrewAI Manager", version="3.0.0")

# ═══════════════════════════════════════════
# 에이전트 매니페스트 — capability 정의
# ═══════════════════════════════════════════

AGENTS = {
    "Hermes": {
        "endpoint": "http://localhost:8000/chat",
        "shell": "/bin/bash",
        "container": None,
        "capabilities": [
            "analysis", "reasoning", "document_summary", "classification",
            "pdf_processing", "writing", "translation", "question_answering"
        ],
        "keywords": ["분석", "요약", "정리", "번역", "문서", "PDF", "추론", "설명"]
    },
    "MetaGPT": {
        "endpoint": None,
        "shell": "/bin/bash",
        "container": "aifactory-metagpt",
        "capabilities": [
            "planning", "architecture", "code_generation", "qa",
            "project_design", "software_development"
        ],
        "keywords": ["기획", "설계", "코드 생성", "개발", "프로젝트", "구현", "create", "build"]
    },
    "EJClaw": {
        "endpoint": None,
        "shell": "/bin/bash",
        "container": "aifactory-ejclaw",
        "capabilities": [
            "code_review", "implementation_audit", "quality_validation",
            "bug_detection", "code_analysis"
        ],
        "keywords": ["리뷰", "검토", "심사", "audit", "review", "품질"]
    },
    "OpenCode": {
        "endpoint": None,
        "shell": "/bin/sh",
        "container": "aifactory-opencode",
        "capabilities": [
            "bug_fixing", "fast_implementation", "refactoring",
            "debugging", "hotfix"
        ],
        "keywords": ["버그", "오류", "수정", "고장", "bug", "fix", "error", "fail"]
    },
    "Auto-Trading": {
        "endpoint": None,
        "shell": "/bin/bash",
        "container": "auto-trading",
        "capabilities": [
            "trading", "portfolio_management", "market_analysis",
            "risk_assessment", "report_generation"
        ],
        "keywords": ["주식", "트레이딩", "포트폴리오", "투자", "stock", "trade", "market"]
    }
}

# ═══════════════════════════════════════════
# Capability 매칭 엔진
# ═══════════════════════════════════════════

def match_agents(user_message: str, top_n: int = 2):
    """키워드 기반 capability 매칭 — 점수순 정렬"""
    msg_lower = user_message.lower()
    scores = {}
    
    for name, info in AGENTS.items():
        score = 0
        # 키워드 매칭
        for kw in info["keywords"]:
            if kw.lower() in msg_lower:
                score += 10
        # Capability 이름도 매칭
        for cap in info["capabilities"]:
            if cap.replace("_", " ") in msg_lower or cap in msg_lower:
                score += 5
        if score > 0:
            scores[name] = score
    
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    return ranked[:top_n]

# ═══════════════════════════════════════════
# GitHub 추천 검색
# ═══════════════════════════════════════════

async def search_github_repos(query: str, max_results: int = 5) -> list:
    """capability 불일치 시 관련 GitHub 레포 검색"""
    search_query = re.sub(r'[^\w\s가-힣]', ' ', query).strip()
    search_query = ' '.join(search_query.split()[:5])  # 상위 5개 단어만
    
    url = f"https://api.github.com/search/repositories?q={search_query}&sort=stars&per_page={max_results}"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, headers={"Accept": "application/vnd.github.v3+json"})
            if r.status_code == 200:
                items = r.json().get("items", [])
                return [{
                    "name": item["full_name"],
                    "url": item["html_url"],
                    "description": (item.get("description") or "No description")[:100],
                    "stars": item["stargazers_count"],
                    "language": item.get("language") or "unknown"
                } for item in items[:max_results]]
    except:
        pass
    return []

# ═══════════════════════════════════════════
# Shell 감지
# ═══════════════════════════════════════════

SHELL_CACHE = {}

def detect_shell(container: str) -> str:
    if container in SHELL_CACHE:
        return SHELL_CACHE[container]
    try:
        r = subprocess.run(
            ["docker", "exec", container, "which", "bash"],
            capture_output=True, text=True, timeout=5
        )
        shell = "/bin/bash" if r.returncode == 0 else "/bin/sh"
    except:
        shell = "/bin/sh"
    SHELL_CACHE[container] = shell
    return shell

# ═══════════════════════════════════════════
# Router
# ═══════════════════════════════════════════

async def call_hermes(message: str, timeout: int = 600) -> str:
    async with httpx.AsyncClient(timeout=timeout) as c:
        r = await c.post("http://localhost:8000/chat", json={"message": message})
        return r.json().get("reply", str(r.text))

async def route(user_message: str) -> dict:
    # 1. Capability 매칭
    matches = match_agents(user_message)
    
    if not matches:
        # 매칭 실패 → 연결된 레포 없음 → GitHub 추천
        repos = await search_github_repos(user_message)
        if repos:
            repo_lines = "\n".join(
                f"- [{r['name']}]({r['url']}) — ⭐{r['stars']} {r['language']}\n  {r['description']}"
                for r in repos
            )
            return {
                "route": "recommendation",
                "reply": f"해당 요청을 처리할 에이전트가 없습니다. 관련 GitHub 레포지토리를 추천합니다:\n\n{repo_lines}"
            }
        return {
            "route": "unknown",
            "reply": f"요청을 이해하지 못했습니다: `{user_message[:100]}...`"
        }
    
    # 2. 매칭 성공 → Hermes에 라우팅
    matched_names = [m[0] for m in matches]
    agent_info = "\n".join(
        f"- {name} ({info['container'] or 'HTTP'}): {', '.join(info['capabilities'])}"
        for name in matched_names
        for n, info in AGENTS.items() if n == name
    )
    
    routing_prompt = f"""You are the CrewAI orchestrator. Route to the matched agent and execute.

Matched agents:
{agent_info}

User: {user_message}

1. Confirm which agent(s) to use
2. Execute the task
3. Return the result"""
    
    reply = await call_hermes(routing_prompt, timeout=600)
    return {"route": matches[0][0], "reply": reply}


# ═══════════════════════════════════════════
# API
# ═══════════════════════════════════════════

class RouteRequest(BaseModel):
    message: str
    session_id: Optional[str] = None

class RouteResponse(BaseModel):
    reply: str
    route: Optional[str] = None
    session_id: Optional[str] = None

@app.post("/route")
async def route_post(request: RouteRequest):
    try:
        result = await route(request.message)
        return RouteResponse(
            reply=result["reply"],
            route=result.get("route"),
            session_id=request.session_id or "crewai"
        )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="응답 시간 초과")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "3.0.0",
        "agents": list(AGENTS.keys()),
        "shells": SHELL_CACHE
    }

@app.get("/agents")
async def list_agents():
    """등록된 에이전트 목록과 capability 반환"""
    return {
        agent: {
            "capabilities": info["capabilities"],
            "keywords": info["keywords"]
        }
        for agent, info in AGENTS.items()
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("CREWAI_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info", timeout_keep_alive=120)
