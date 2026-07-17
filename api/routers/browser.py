"""Browser automation API endpoints."""


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from open_notebook.browser.service import browser_service

router = APIRouter()


class NavigateRequest(BaseModel):
    session_id: str
    url: str


class ClickRequest(BaseModel):
    session_id: str
    selector: str


class TypeRequest(BaseModel):
    session_id: str
    selector: str
    text: str


class ScrollRequest(BaseModel):
    session_id: str
    direction: str = "down"
    amount: int = 500


class ScreenshotRequest(BaseModel):
    session_id: str


class BrowserActionRequest(BaseModel):
    session_id: str
    action: dict


@router.get("/browser/status")
async def browser_status():
    """Check if the browser service is running."""
    return {
        "status": "available",
        "running": browser_service._browser is not None
    }


@router.post("/browser/navigate")
async def browser_navigate(request: NavigateRequest):
    """Navigate to a URL."""
    state = await browser_service.navigate(request.session_id, request.url)
    if state.error:
        raise HTTPException(status_code=500, detail=state.error)
    return {
        "url": state.url,
        "title": state.title,
        "screenshot": state.screenshot,
        "content": state.content[:2000],
        "links": state.links[:30]
    }


@router.post("/browser/screenshot")
async def browser_screenshot(request: ScreenshotRequest):
    """Take a screenshot of the current page."""
    state = await browser_service.screenshot(request.session_id)
    if state.error:
        raise HTTPException(status_code=500, detail=state.error)
    return {
        "url": state.url,
        "title": state.title,
        "screenshot": state.screenshot,
        "content": state.content[:2000]
    }


@router.post("/browser/click")
async def browser_click(request: ClickRequest):
    """Click an element on the page."""
    state = await browser_service.click(request.session_id, request.selector)
    if state.error:
        raise HTTPException(status_code=500, detail=state.error)
    return {
        "url": state.url,
        "title": state.title,
        "screenshot": state.screenshot,
        "content": state.content[:2000]
    }


@router.post("/browser/type")
async def browser_type(request: TypeRequest):
    """Type text into an element."""
    state = await browser_service.type_text(request.session_id, request.selector, request.text)
    if state.error:
        raise HTTPException(status_code=500, detail=state.error)
    return {
        "url": state.url,
        "title": state.title,
        "screenshot": state.screenshot
    }


@router.post("/browser/scroll")
async def browser_scroll(request: ScrollRequest):
    """Scroll the page."""
    state = await browser_service.scroll(request.session_id, request.direction, request.amount)
    if state.error:
        raise HTTPException(status_code=500, detail=state.error)
    return {
        "url": state.url,
        "title": state.title,
        "screenshot": state.screenshot,
        "content": state.content[:2000]
    }


@router.post("/browser/back")
async def browser_back(request: ScreenshotRequest):
    """Go back in browser history."""
    state = await browser_service.back(request.session_id)
    if state.error:
        raise HTTPException(status_code=500, detail=state.error)
    return {
        "url": state.url,
        "title": state.title,
        "screenshot": state.screenshot,
        "content": state.content[:2000]
    }


@router.post("/browser/forward")
async def browser_forward(request: ScreenshotRequest):
    """Go forward in browser history."""
    state = await browser_service.forward(request.session_id)
    if state.error:
        raise HTTPException(status_code=500, detail=state.error)
    return {
        "url": state.url,
        "title": state.title,
        "screenshot": state.screenshot,
        "content": state.content[:2000]
    }


@router.post("/browser/action")
async def browser_action(request: BrowserActionRequest):
    """Execute a browser action."""
    state = await browser_service.execute_action(request.session_id, request.action)
    if state.error:
        raise HTTPException(status_code=500, detail=state.error)
    return {
        "url": state.url,
        "title": state.title,
        "screenshot": state.screenshot,
        "content": state.content[:2000],
        "links": state.links[:20]
    }
