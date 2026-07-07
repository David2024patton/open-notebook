"""Browser automation service using Playwright for AI-powered web browsing."""

import asyncio
import base64
import io
from dataclasses import dataclass, field
from typing import Optional

from loguru import logger
from playwright.async_api import async_playwright, Browser, Page, BrowserContext


@dataclass
class BrowserState:
    """State of a browser session."""
    url: str = "about:blank"
    title: str = ""
    screenshot: Optional[str] = None  # base64 encoded PNG
    content: str = ""  # page text content
    links: list[dict] = field(default_factory=list)  # clickable links
    forms: list[dict] = field(default_factory=list)  # form elements
    error: Optional[str] = None


class BrowserService:
    """Manages browser instances for AI-powered web browsing."""

    def __init__(self):
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._contexts: dict[str, BrowserContext] = {}
        self._pages: dict[str, Page] = {}

    async def start(self):
        """Start the Playwright browser."""
        if self._browser:
            return
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--use-gl=swiftshader',
                '--disable-software-rasterizer',
            ]
        )
        logger.info("Browser service started")

    async def stop(self):
        """Stop the Playwright browser."""
        for ctx in self._contexts.values():
            try:
                await ctx.close()
            except Exception:
                pass
        self._contexts.clear()
        self._pages.clear()
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
        logger.info("Browser service stopped")

    async def get_or_create_page(self, session_id: str) -> Page:
        """Get or create a page for a session."""
        if session_id in self._pages:
            page = self._pages[session_id]
            if not page.is_closed():
                return page

        if not self._browser:
            await self.start()

        context = await self._browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        self._contexts[session_id] = context
        page = await context.new_page()
        self._pages[session_id] = page
        return page

    async def navigate(self, session_id: str, url: str) -> BrowserState:
        """Navigate to a URL and return the page state."""
        try:
            page = await self.get_or_create_page(session_id)

            # Add https:// if no protocol specified
            if not url.startswith(('http://', 'https://', 'file://')):
                url = 'https://' + url

            await page.goto(url, wait_until='networkidle', timeout=30000)
            await page.wait_for_timeout(2000)  # Wait for dynamic content and rendering

            return await self._capture_state(page)
        except Exception as e:
            logger.error(f"Navigation error: {e}")
            return BrowserState(error=str(e))

    async def screenshot(self, session_id: str) -> BrowserState:
        """Take a screenshot of the current page."""
        try:
            page = await self.get_or_create_page(session_id)
            return await self._capture_state(page)
        except Exception as e:
            logger.error(f"Screenshot error: {e}")
            return BrowserState(error=str(e))

    async def click(self, session_id: str, selector: str) -> BrowserState:
        """Click an element on the page."""
        try:
            page = await self.get_or_create_page(session_id)
            await page.click(selector, timeout=5000)
            await page.wait_for_timeout(500)
            return await self._capture_state(page)
        except Exception as e:
            logger.error(f"Click error: {e}")
            return BrowserState(error=str(e))

    async def type_text(self, session_id: str, selector: str, text: str) -> BrowserState:
        """Type text into an element."""
        try:
            page = await self.get_or_create_page(session_id)
            await page.fill(selector, text, timeout=5000)
            return await self._capture_state(page)
        except Exception as e:
            logger.error(f"Type error: {e}")
            return BrowserState(error=str(e))

    async def scroll(self, session_id: str, direction: str = "down", amount: int = 500) -> BrowserState:
        """Scroll the page."""
        try:
            page = await self.get_or_create_page(session_id)
            if direction == "down":
                await page.evaluate(f"window.scrollBy(0, {amount})")
            elif direction == "up":
                await page.evaluate(f"window.scrollBy(0, -{amount})")
            elif direction == "bottom":
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            elif direction == "top":
                await page.evaluate("window.scrollTo(0, 0)")
            await page.wait_for_timeout(300)
            return await self._capture_state(page)
        except Exception as e:
            logger.error(f"Scroll error: {e}")
            return BrowserState(error=str(e))

    async def back(self, session_id: str) -> BrowserState:
        """Go back in browser history."""
        try:
            page = await self.get_or_create_page(session_id)
            await page.go_back(wait_until='domcontentloaded')
            await page.wait_for_timeout(500)
            return await self._capture_state(page)
        except Exception as e:
            logger.error(f"Back error: {e}")
            return BrowserState(error=str(e))

    async def forward(self, session_id: str) -> BrowserState:
        """Go forward in browser history."""
        try:
            page = await self.get_or_create_page(session_id)
            await page.go_forward(wait_until='domcontentloaded')
            await page.wait_for_timeout(500)
            return await self._capture_state(page)
        except Exception as e:
            logger.error(f"Forward error: {e}")
            return BrowserState(error=str(e))

    async def get_content(self, session_id: str) -> BrowserState:
        """Get the text content of the page."""
        try:
            page = await self.get_or_create_page(session_id)
            return await self._capture_state(page, include_screenshot=False)
        except Exception as e:
            logger.error(f"Get content error: {e}")
            return BrowserState(error=str(e))

    async def execute_action(self, session_id: str, action: dict) -> BrowserState:
        """Execute a browser action from the AI."""
        action_type = action.get("type")

        if action_type == "navigate":
            return await self.navigate(session_id, action["url"])
        elif action_type == "click":
            return await self.click(session_id, action["selector"])
        elif action_type == "type":
            return await self.type_text(session_id, action["selector"], action["text"])
        elif action_type == "scroll":
            return await self.scroll(session_id, action.get("direction", "down"), action.get("amount", 500))
        elif action_type == "back":
            return await self.back(session_id)
        elif action_type == "forward":
            return await self.forward(session_id)
        elif action_type == "screenshot":
            return await self.screenshot(session_id)
        elif action_type == "content":
            return await self.get_content(session_id)
        else:
            return BrowserState(error=f"Unknown action type: {action_type}")

    async def _capture_state(self, page: Page, include_screenshot: bool = True) -> BrowserState:
        """Capture the current state of a page."""
        state = BrowserState()

        try:
            state.url = page.url
            state.title = await page.title()

            if include_screenshot:
                # Ensure page has rendered by waiting for body
                try:
                    await page.wait_for_selector('body', timeout=5000)
                except Exception:
                    pass
                # Set viewport background to white to avoid black screenshots
                await page.evaluate("""
                    () => {
                        if (window.getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)') {
                            document.body.style.backgroundColor = '#ffffff';
                        }
                    }
                """)
                screenshot_bytes = await page.screenshot(type='png', full_page=False)
                state.screenshot = base64.b64encode(screenshot_bytes).decode('utf-8')

            # Get text content (truncated)
            text_content = await page.evaluate("""
                () => {
                    const body = document.body;
                    if (!body) return '';
                    // Remove script and style elements
                    const clone = body.cloneNode(true);
                    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
                    return clone.innerText.substring(0, 10000);
                }
            """)
            state.content = text_content

            # Get clickable links
            state.links = await page.evaluate("""
                () => {
                    const links = [];
                    document.querySelectorAll('a[href]').forEach((a, i) => {
                        if (i < 50 && a.textContent.trim()) {
                            links.push({
                                text: a.textContent.trim().substring(0, 100),
                                href: a.href,
                                selector: a.getAttribute('data-on-selector') || ''
                            });
                        }
                    });
                    return links;
                }
            """)

        except Exception as e:
            state.error = str(e)

        return state


# Singleton instance
browser_service = BrowserService()
