"""
Git Repository Processor for Open Notebook.

Detects Git URLs (GitHub, GitLab, Bitbucket, etc.) and ingests
the entire repository by cloning and extracting key files.
"""

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from loguru import logger

# File extensions to include as code
CODE_EXTENSIONS = {
    # Python
    ".py", ".pyw", ".pyi",
    # JavaScript/TypeScript
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    # Web
    ".html", ".htm", ".css", ".scss", ".less",
    # Config/Build
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".env", ".env.example",
    # Shell
    ".sh", ".bash", ".zsh", ".fish",
    # Documentation
    ".md", ".mdx", ".rst", ".txt",
    # Go
    ".go",
    # Rust
    ".rs",
    # Java/Kotlin
    ".java", ".kt", ".kts",
    # C/C++
    ".c", ".cpp", ".h", ".hpp",
    # Ruby
    ".rb", ".erb",
    # PHP
    ".php",
    # SQL
    ".sql",
    # Docker
    "Dockerfile", ".dockerignore",
    # Git
    ".gitignore",
    # Project files
    "Makefile", "makefile", "CMakeLists.txt",
    "requirements.txt", "setup.py", "setup.cfg", "pyproject.toml",
    "package.json", "tsconfig.json", "Cargo.toml", "go.mod",
    "Gemfile", "composer.json",
}

# Directories to skip
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "env",
    ".tox", ".mypy_cache", ".pytest_cache", "dist", "build",
    ".next", ".nuxt", ".output", "coverage",
    "vendor", "target", "bin", "obj",
    ".idea", ".vscode", ".vs",
    "__snapshots__", ".git",
}

# Max file size to include (100KB)
MAX_FILE_SIZE = 100 * 1024

# Max total content size (500KB)
MAX_TOTAL_SIZE = 500 * 1024


def is_git_url(url: str) -> bool:
    """Check if a URL is a Git repository URL."""
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    
    git_hosts = {
        "github.com", "gitlab.com", "bitbucket.org",
        "codeberg.org", "gitee.com", "sourceforge.net",
        "git.sr.ht", "codeberg.org",
        "dev.azure.com", "visualstudio.com",
    }
    
    # Check for known Git hosts
    if hostname in git_hosts:
        return True
    
    # Check for .git suffix or git:// protocol
    if parsed.scheme in ("git", "git+ssh", "git+https"):
        return True
    if parsed.path.endswith(".git"):
        return True
    
    return False


def extract_repo_info(url: str) -> dict:
    """Extract owner and repo name from a Git URL."""
    parsed = urlparse(url)
    path = parsed.path.strip("/")
    
    # Remove .git suffix
    if path.endswith(".git"):
        path = path[:-4]
    
    parts = path.split("/")
    if len(parts) >= 2:
        return {"owner": parts[0], "repo": parts[1]}
    return {"owner": "", "repo": path}


def get_clone_url(url: str) -> str:
    """Convert any Git URL to an HTTPS clone URL."""
    parsed = urlparse(url)
    
    # Already HTTPS
    if parsed.scheme == "https":
        return url
    
    # SSH to HTTPS conversion
    if parsed.scheme == "ssh" or (parsed.hostname and ":" in url):
        hostname = parsed.hostname or "github.com"
        path = parsed.path.strip("/")
        return f"https://{hostname}/{path}"
    
    # git:// protocol
    if parsed.scheme == "git":
        return f"https:/{parsed.path}"
    
    return url


def should_include_file(filepath: Path) -> bool:
    """Determine if a file should be included in the extraction."""
    # Check extension
    if filepath.suffix in CODE_EXTENSIONS:
        return True
    
    # Check filename without extension (for files like Dockerfile, Makefile)
    if filepath.name in CODE_EXTENSIONS:
        return True
    
    # Include any file under 10KB that looks like config
    if filepath.stat().st_size < 10240:
        try:
            content = filepath.read_text(encoding="utf-8", errors="ignore")
            # If it has key-value pairs or config-like content
            if any(line.strip().startswith(("=", "#", "[", "{")) for line in content[:50]):
                return True
        except Exception:
            pass
    
    return False


def extract_file_tree(repo_path: Path, prefix: str = "") -> str:
    """Generate a tree-like view of the repository structure."""
    lines = []
    items = sorted(repo_path.iterdir(), key=lambda x: (x.is_file(), x.name))
    
    for item in items:
        if item.name in SKIP_DIRS:
            continue
        if item.name.startswith(".") and item.name != ".env.example":
            continue
        
        if item.is_dir():
            lines.append(f"{prefix}{item.name}/")
            subdir_content = extract_file_tree(item, prefix + "  ")
            if subdir_content:
                lines.append(subdir_content)
        else:
            size = item.stat().st_size
            if size < 1024:
                size_str = f"{size}B"
            elif size < 1024 * 1024:
                size_str = f"{size // 1024}KB"
            else:
                size_str = f"{size // (1024 * 1024)}MB"
            lines.append(f"{prefix}{item.name} ({size_str})")
    
    return "\n".join(lines)


def extract_readme(repo_path: Path) -> Optional[str]:
    """Extract README content from the repo."""
    readme_names = [
        "README.md", "readme.md", "README.rst", "readme.rst",
        "README.txt", "readme.txt", "README", "readme",
    ]
    
    for name in readme_names:
        readme_path = repo_path / name
        if readme_path.exists():
            try:
                content = readme_path.read_text(encoding="utf-8", errors="ignore")
                # Truncate if too long
                if len(content) > 10000:
                    content = content[:10000] + "\n\n... (truncated)"
                return content
            except Exception as e:
                logger.warning(f"Failed to read README: {e}")
    
    return None


def extract_code_files(repo_path: Path) -> list[dict]:
    """Extract key code files from the repo."""
    files = []
    total_size = 0
    
    for filepath in repo_path.rglob("*"):
        if not filepath.is_file():
            continue
        
        # Skip directories and large files
        if any(skip in filepath.parts for skip in SKIP_DIRS):
            continue
        if filepath.stat().st_size > MAX_FILE_SIZE:
            continue
        if total_size >= MAX_TOTAL_SIZE:
            break
        
        if should_include_file(filepath):
            try:
                content = filepath.read_text(encoding="utf-8", errors="ignore")
                rel_path = filepath.relative_to(repo_path)
                files.append({
                    "path": str(rel_path),
                    "content": content,
                    "size": len(content),
                })
                total_size += len(content)
            except Exception:
                continue
    
    return files


async def clone_repo(url: str, dest: Path) -> bool:
    """Clone a Git repository (shallow clone)."""
    clone_url = get_clone_url(url)
    
    cmd = [
        "git", "clone",
        "--depth", "1",           # Shallow clone
        "--single-branch",        # Only default branch
        "--recurse-submodules=false",  # Skip submodules
        clone_url,
        str(dest),
    ]
    
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=120)
        
        if process.returncode != 0:
            error_msg = stderr.decode("utf-8", errors="ignore")
            logger.error(f"Git clone failed: {error_msg}")
            return False
        
        return True
    except asyncio.TimeoutError:
        logger.error("Git clone timed out after 120 seconds")
        return False
    except FileNotFoundError:
        logger.error("Git is not installed on the system")
        return False
    except Exception as e:
        logger.error(f"Git clone error: {e}")
        return False


async def extract_git_repo(url: str) -> dict:
    """
    Extract content from a Git repository.
    
    Returns dict with:
        - content: Formatted markdown content
        - title: Repository title
        - metadata: Repository metadata
    """
    repo_info = extract_repo_info(url)
    repo_name = f"{repo_info['owner']}/{repo_info['repo']}" if repo_info['owner'] else repo_info['repo']
    
    logger.info(f"Extracting Git repository: {repo_name}")
    
    # Create temp directory for clone
    temp_dir = Path(tempfile.mkdtemp(prefix="opennotebook_git_"))
    repo_path = temp_dir / "repo"
    
    try:
        # Clone the repository
        success = await clone_repo(url, repo_path)
        if not success:
            return {
                "content": "",
                "title": f"GitHub - {repo_name}" if "github.com" in url else repo_name,
                "metadata": {"url": url, "error": "Failed to clone repository"},
            }
        
        # Extract content
        sections = []
        
        # Title and metadata
        sections.append(f"# {repo_name}\n")
        sections.append(f"Source: {url}\n")
        
        # README
        readme = extract_readme(repo_path)
        if readme:
            sections.append("## README\n")
            sections.append(readme)
            sections.append("")
        
        # File tree
        tree = extract_file_tree(repo_path)
        if tree:
            sections.append("## Repository Structure\n")
            sections.append("```\n" + tree + "\n```")
            sections.append("")
        
        # Key code files
        code_files = extract_code_files(repo_path)
        if code_files:
            sections.append("## Source Code\n")
            for file_info in code_files:
                sections.append(f"### {file_info['path']}\n")
                sections.append(f"```\n{file_info['content']}\n```\n")
        
        content = "\n".join(sections)
        
        # Get repo description if available
        description = ""
        desc_file = repo_path / "README.md"
        if desc_file.exists():
            try:
                lines = desc_file.read_text(encoding="utf-8", errors="ignore").split("\n")
                # Find first non-empty, non-header line
                for line in lines:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#"):
                        description = stripped[:200]
                        break
            except Exception:
                pass
        
        return {
            "content": content,
            "title": f"GitHub - {repo_name}" if "github.com" in url else repo_name,
            "metadata": {
                "url": url,
                "repo_name": repo_name,
                "owner": repo_info["owner"],
                "files_count": len(code_files),
                "description": description,
            },
        }
    
    finally:
        # Cleanup
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
