import os
import uuid
import logging
from typing import List, Dict, Any, Optional

import uvicorn
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from google import genai
from google.genai import types

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agentic_app")

# Project environment setup
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "qwiklabs-gcp-02-592cddb90c6e")
LOCATION = os.environ.get("LOCATION", "us-central1")

# Initialize Gemini Client
try:
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    logger.info(f"Gemini Client initialized for project {PROJECT_ID}")
except Exception as e:
    logger.error(f"Failed to initialize Gemini Client: {e}")
    client = None

app = FastAPI(title="ChatGPT-Style Agentic AI")

# In-memory session chat history storage
# session_id -> list of message contents/dict
session_histories: Dict[str, List[Any]] = {}

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    model: Optional[str] = "gemini-2.5-flash"
    enable_search: Optional[bool] = True
    enable_code: Optional[bool] = True

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "project": PROJECT_ID, "client_ready": client is not None}

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    if not client:
        return JSONResponse(
            status_code=500,
            content={"error": "Gemini Client is not initialized on the server."}
        )
    
    session_id = request.session_id or str(uuid.uuid4())
    user_prompt = request.message.strip()
    
    if not user_prompt:
        raise HTTPException(status_code=400, detail="Message content cannot be empty.")
    
    # Configure tools dynamically based on user selections
    # Note: Vertex AI Gemini API allows one tool type per request (or search tools)
    tools_list = []
    
    # Smart intent detection if both are enabled
    search_keywords = ["search", "latest", "news", "today", "current", "who is", "weather", "price", "recent", "stock", "update"]
    user_lower = user_prompt.lower()
    
    wants_search = any(k in user_lower for k in search_keywords)
    
    if request.enable_code and request.enable_search:
        if wants_search:
            tools_list.append(types.Tool(google_search=types.GoogleSearch()))
        else:
            tools_list.append(types.Tool(code_execution=types.ToolCodeExecution()))
    elif request.enable_code:
        tools_list.append(types.Tool(code_execution=types.ToolCodeExecution()))
    elif request.enable_search:
        tools_list.append(types.Tool(google_search=types.GoogleSearch()))
    
    config = types.GenerateContentConfig(
        system_instruction=(
            "You are an advanced, highly intelligent agentic AI assistant (similar to ChatGPT / Gemini Advanced). "
            "You have direct access to tools like Google Search for real-time web info and a Python Code Execution Sandbox. "
            "When asked to write code, solve mathematical problems, or process data, use your Python sandbox to execute the code "
            "and output exact results. Provide clear, structured, well-formatted Markdown responses with syntax-highlighted code blocks."
        ),
        tools=tools_list if tools_list else None,
        temperature=0.7,
    )
    
    # Retrieve or initialize session history
    history = session_histories.get(session_id, [])
    
    # Append new user message
    history.append({"role": "user", "parts": [user_prompt]})
    
    # Select requested model
    model_name = request.model or "gemini-2.5-flash"
    
    try:
        # Call Gemini Model with full session context
        # We convert internal history to format expected by SDK or pass chat session
        contents_payload = []
        for msg in history:
            contents_payload.append(
                types.Content(
                    role=msg["role"],
                    parts=[types.Part.from_text(text=p) if isinstance(p, str) else types.Part.from_text(text=p.get("text", "")) for p in msg["parts"]]
                )
            )
        
        response = client.models.generate_content(
            model=model_name,
            contents=contents_payload,
            config=config
        )
        
        assistant_text = ""
        tool_activities = []
        
        if response.candidates and response.candidates[0].content:
            parts = response.candidates[0].content.parts
            for p in parts:
                if getattr(p, "text", None):
                    assistant_text += p.text + "\n"
                
                # Check for Python executable code
                exec_code = getattr(p, "executable_code", None)
                if exec_code:
                    tool_activities.append({
                        "type": "code_execution",
                        "code": exec_code.code,
                        "language": getattr(exec_code, "language", "python")
                    })
                
                # Check for Python execution results
                exec_result = getattr(p, "code_execution_result", None)
                if exec_result:
                    tool_activities.append({
                        "type": "code_result",
                        "output": exec_result.output,
                        "outcome": getattr(exec_result, "outcome", "OK")
                    })
        
        # Grounding / Search metadata
        search_sources = []
        if response.candidates and response.candidates[0].grounding_metadata:
            gm = response.candidates[0].grounding_metadata
            if getattr(gm, "grounding_chunks", None):
                for chunk in gm.grounding_chunks:
                    if getattr(chunk, "web", None):
                        search_sources.append({
                            "title": chunk.web.title,
                            "url": chunk.web.uri
                        })
        
        # Save assistant turn to session history
        history.append({"role": "model", "parts": [assistant_text]})
        session_histories[session_id] = history
        
        return {
            "session_id": session_id,
            "text": assistant_text.strip(),
            "tools_used": tool_activities,
            "search_sources": search_sources,
            "model_used": model_name
        }

    except Exception as e:
        logger.error(f"Error calling Gemini: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Agent Execution Error: {str(e)}", "session_id": session_id}
        )

@app.delete("/api/sessions/{session_id}")
async def clear_session(session_id: str):
    if session_id in session_histories:
        del session_histories[session_id]
    return {"status": "cleared", "session_id": session_id}

# Mount static files directory for frontend web UI
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"Starting ChatGPT Agentic Web App on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
