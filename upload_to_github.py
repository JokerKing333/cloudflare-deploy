"""
GitHub 自动上传脚本
将 cloudflare-deploy 文件夹上传到 JokerKing333 的 GitHub 仓库

使用方法：
    1. 在 GitHub 创建 Personal Access Token（Settings → Developer settings → Tokens (classic)）
       勾选 repo 权限
    2. 设置环境变量 GITHUB_TOKEN，或直接修改下方 GITHUB_TOKEN 变量
    3. 运行：python upload_to_github.py

功能：
    - 自动创建仓库（如果不存在）
    - 递归上传整个 cloudflare-deploy 文件夹
    - 处理文件冲突（覆盖更新）
    - 完整的错误处理和重试机制
"""

import os
import sys
import json
import base64
import hashlib
import time
import urllib.request
import urllib.error
from pathlib import Path

# ========== 配置 ==========
GITHUB_USERNAME = "JokerKing333"
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "YOUR_GITHUB_TOKEN_HERE")
REPO_NAME = "cloudflare-deploy"
REPO_DESCRIPTION = "AI 智能助手 - Cloudflare Pages 部署版（支持思考链展示和联网搜索）"
REPO_PRIVATE = False  # 公开仓库
BRANCH = "main"

# 要上传的文件夹路径（相对于本脚本所在目录）
SOURCE_DIR = Path(__file__).parent

# 要排除的文件/文件夹
EXCLUDE_PATTERNS = [
    "__pycache__",
    "*.pyc",
    ".git",
    ".gitignore",
    "upload_to_github.py",  # 不上传脚本自身
    "node_modules",
    ".DS_Store",
]

# GitHub API 基础 URL
GITHUB_API = "https://api.github.com"


# ========== 工具函数 ==========

def log(msg, level="INFO"):
    """带时间戳的日志输出"""
    timestamp = time.strftime("%H:%M:%S")
    prefix = {"INFO": "[INFO]", "SUCCESS": "[OK]", "WARNING": "[WARN]", "ERROR": "[ERR]"}.get(level, "[INFO]")
    print(f"[{timestamp}] {prefix} {msg}")


def api_request(method, endpoint, data=None, retries=3):
    """
    发送 GitHub API 请求，带重试机制
    
    Args:
        method: HTTP 方法 (GET, POST, PUT, DELETE, PATCH)
        endpoint: API 端点路径（如 /user/repos）
        data: 请求体（字典，会自动转为 JSON）
        retries: 最大重试次数
    
    Returns:
        tuple: (响应数据字典, 响应头字典)
    
    Raises:
        Exception: 请求失败时抛出异常
    """
    url = f"{GITHUB_API}{endpoint}"
    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "GitHub-Upload-Script/1.0",
    }

    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"

    last_error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req) as response:
                response_data = response.read().decode("utf-8")
                response_headers = dict(response.headers)
                if response_data:
                    return json.loads(response_data), response_headers
                return {}, response_headers
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else ""
            last_error = f"HTTP {e.code}: {error_body[:500]}"

            # 409 Conflict（仓库已存在）不算错误
            if e.code == 409:
                return {"error": "conflict", "message": error_body}, {}

            # 422 Unprocessable Entity
            if e.code == 422:
                return {"error": "unprocessable", "message": error_body}, {}

            # 401/403 认证错误不重试
            if e.code in (401, 403):
                raise Exception(f"认证失败: {last_error}")

            if attempt < retries - 1:
                wait = 2 ** attempt
                log(f"请求失败，{wait}秒后重试... ({attempt + 1}/{retries})", "WARNING")
                time.sleep(wait)
        except urllib.error.URLError as e:
            last_error = str(e)
            if attempt < retries - 1:
                wait = 2 ** attempt
                log(f"网络错误，{wait}秒后重试... ({attempt + 1}/{retries})", "WARNING")
                time.sleep(wait)

    raise Exception(f"API 请求失败（已重试 {retries} 次）: {last_error}")


def should_exclude(file_path):
    """检查文件是否应该被排除"""
    rel_path = str(file_path.relative_to(SOURCE_DIR))
    for pattern in EXCLUDE_PATTERNS:
        if pattern.startswith("*"):
            # 通配符匹配（如 *.pyc）
            if file_path.match(pattern):
                return True
        else:
            # 精确匹配或目录匹配
            if pattern in rel_path.split(os.sep):
                return True
    return False


def get_file_sha(repo_full_name, file_path):
    """
    获取远程仓库中文件的 SHA（用于更新文件）
    
    Args:
        repo_full_name: 仓库全名（如 JokerKing333/cloudflare-deploy）
        file_path: 文件在仓库中的路径
    
    Returns:
        str or None: 文件的 SHA 值，如果文件不存在返回 None
    """
    try:
        endpoint = f"/repos/{repo_full_name}/contents/{file_path}?ref={BRANCH}"
        data, _ = api_request("GET", endpoint)
        return data.get("sha")
    except Exception:
        return None


def get_all_remote_files(repo_full_name, path=""):
    """
    递归获取远程仓库中所有文件的路径和 SHA
    
    Args:
        repo_full_name: 仓库全名
        path: 目录路径
    
    Returns:
        dict: {文件路径: SHA}
    """
    files = {}
    try:
        endpoint = f"/repos/{repo_full_name}/contents/{path}?ref={BRANCH}"
        data, _ = api_request("GET", endpoint)

        if isinstance(data, list):
            for item in data:
                if item["type"] == "file":
                    files[item["path"]] = item["sha"]
                elif item["type"] == "dir":
                    files.update(get_all_remote_files(repo_full_name, item["path"]))
        elif isinstance(data, dict) and data.get("type") == "file":
            files[data["path"]] = data["sha"]
    except Exception as e:
        log(f"获取远程文件列表时出错: {e}", "WARNING")

    return files


# ========== 核心功能 ==========

def create_or_get_repo():
    """
    创建仓库（如果不存在），否则返回已有仓库信息
    
    Returns:
        str: 仓库全名（如 JokerKing333/cloudflare-deploy）
    """
    repo_full_name = f"{GITHUB_USERNAME}/{REPO_NAME}"

    # 先检查仓库是否已存在
    try:
        data, _ = api_request("GET", f"/repos/{repo_full_name}")
        log(f"仓库已存在: {data['html_url']}", "SUCCESS")
        return repo_full_name
    except Exception:
        log(f"仓库不存在，正在创建...", "INFO")

    # 创建新仓库
    create_data = {
        "name": REPO_NAME,
        "description": REPO_DESCRIPTION,
        "private": REPO_PRIVATE,
        "auto_init": True,  # 自动初始化（创建 README.md 和 main 分支）
    }

    try:
        data, _ = api_request("POST", "/user/repos", create_data)
        log(f"仓库创建成功: {data['html_url']}", "SUCCESS")
        return repo_full_name
    except Exception as e:
        raise Exception(f"创建仓库失败: {e}")


def upload_file(repo_full_name, local_path, remote_path, remote_sha=None):
    """
    上传单个文件到 GitHub 仓库
    
    Args:
        repo_full_name: 仓库全名
        local_path: 本地文件路径（Path 对象）
        remote_path: 远程仓库中的路径
        remote_sha: 远程文件的 SHA（更新时需要）
    
    Returns:
        bool: 是否上传成功
    """
    # 读取文件内容
    try:
        with open(local_path, "rb") as f:
            content = f.read()
    except Exception as e:
        log(f"读取文件失败 {local_path}: {e}", "ERROR")
        return False

    # Base64 编码
    content_b64 = base64.b64encode(content).decode("utf-8")

    # 构建请求体
    body = {
        "message": f"Upload: {remote_path}",
        "content": content_b64,
        "branch": BRANCH,
    }

    if remote_sha:
        body["sha"] = remote_sha
        body["message"] = f"Update: {remote_path}"

    # 发送请求
    endpoint = f"/repos/{repo_full_name}/contents/{remote_path}"
    try:
        data, _ = api_request("PUT", endpoint, body)
        return True
    except Exception as e:
        log(f"上传文件失败 {remote_path}: {e}", "ERROR")
        return False


def upload_directory(repo_full_name):
    """
    递归上传整个 cloudflare-deploy 文件夹
    
    Args:
        repo_full_name: 仓库全名
    
    Returns:
        tuple: (成功数量, 失败数量, 跳过数量)
    """
    log(f"开始扫描文件: {SOURCE_DIR}", "INFO")

    # 收集所有需要上传的文件
    local_files = []
    for file_path in SOURCE_DIR.rglob("*"):
        if file_path.is_file() and not should_exclude(file_path):
            rel_path = file_path.relative_to(SOURCE_DIR)
            # 统一使用正斜杠
            remote_path = str(rel_path).replace("\\", "/")
            local_files.append((file_path, remote_path))

    if not local_files:
        log("没有找到需要上传的文件", "WARNING")
        return 0, 0, 0

    log(f"找到 {len(local_files)} 个文件待上传", "INFO")

    # 获取远程仓库中已有的文件列表
    log("正在获取远程仓库文件列表...", "INFO")
    remote_files = get_all_remote_files(repo_full_name)
    log(f"远程仓库已有 {len(remote_files)} 个文件", "INFO")

    # 上传文件
    success_count = 0
    fail_count = 0
    skip_count = 0

    for i, (local_path, remote_path) in enumerate(local_files, 1):
        # 计算本地文件 SHA
        with open(local_path, "rb") as f:
            local_content = f.read()
        local_sha_blob = hashlib.sha1(
            f"blob {len(local_content)}\0".encode() + local_content
        ).hexdigest()

        # 检查远程文件是否相同
        remote_sha = remote_files.get(remote_path)
        if remote_sha:
            # 获取远程文件的 git SHA（不是 blob SHA）
            # 如果远程文件存在，我们需要用它的 SHA 来更新
            try:
                endpoint = f"/repos/{repo_full_name}/git/blobs/{remote_sha}"
                blob_data, _ = api_request("GET", endpoint)
                remote_blob_sha = blob_data.get("sha", "")
                if remote_blob_sha == local_sha_blob:
                    log(f"[{i}/{len(local_files)}] 跳过（未变更）: {remote_path}", "INFO")
                    skip_count += 1
                    continue
            except Exception:
                pass

        # 上传文件
        log(f"[{i}/{len(local_files)}] 上传中: {remote_path}", "INFO")
        if upload_file(repo_full_name, local_path, remote_path, remote_sha):
            success_count += 1
            log(f"[{i}/{len(local_files)}] 上传成功: {remote_path}", "SUCCESS")
        else:
            fail_count += 1

        # 避免触发 GitHub 速率限制（5000 请求/小时）
        if i % 10 == 0:
            time.sleep(0.5)

    return success_count, fail_count, skip_count


def delete_obsolete_files(repo_full_name, local_files_remote_paths):
    """
    删除远程仓库中存在但本地不存在的文件
    
    Args:
        repo_full_name: 仓库全名
        local_files_remote_paths: 本地文件的远程路径集合
    """
    remote_files = get_all_remote_files(repo_full_name)

    # 排除自动生成的文件
    auto_generated = {"README.md", ".gitignore", "LICENSE"}

    obsolete = []
    for remote_path, sha in remote_files.items():
        if remote_path in auto_generated:
            continue
        if remote_path not in local_files_remote_paths:
            obsolete.append((remote_path, sha))

    if not obsolete:
        return

    log(f"发现 {len(obsolete)} 个远程多余文件", "WARNING")
    for remote_path, sha in obsolete:
        log(f"  删除远程文件: {remote_path}", "WARNING")
        try:
            endpoint = f"/repos/{repo_full_name}/contents/{remote_path}"
            body = {
                "message": f"Remove obsolete file: {remote_path}",
                "sha": sha,
                "branch": BRANCH,
            }
            api_request("DELETE", endpoint, body)
            log(f"  已删除: {remote_path}", "SUCCESS")
        except Exception as e:
            log(f"  删除失败 {remote_path}: {e}", "ERROR")


# ========== 主流程 ==========

def main():
    """主函数"""
    print("=" * 60)
    print("  GitHub 自动上传脚本")
    print(f"  目标仓库: {GITHUB_USERNAME}/{REPO_NAME}")
    print(f"  源文件夹: {SOURCE_DIR}")
    print("=" * 60)
    print()

    # 验证 Token
    if GITHUB_TOKEN == "YOUR_GITHUB_TOKEN_HERE":
        log("请先设置 GITHUB_TOKEN 环境变量或修改脚本中的 GITHUB_TOKEN", "ERROR")
        log("获取 Token: GitHub → Settings → Developer settings → Tokens (classic)", "INFO")
        log("需要勾选 repo 权限", "INFO")
        sys.exit(1)

    # 验证 Token 有效性
    log("验证 GitHub Token...", "INFO")
    try:
        user_data, _ = api_request("GET", "/user")
        log(f"认证成功，当前用户: {user_data.get('login', 'unknown')}", "SUCCESS")
    except Exception as e:
        log(f"Token 验证失败: {e}", "ERROR")
        sys.exit(1)

    # 创建或获取仓库
    try:
        repo_full_name = create_or_get_repo()
    except Exception as e:
        log(f"仓库操作失败: {e}", "ERROR")
        sys.exit(1)

    # 上传文件
    print()
    log("开始上传文件...", "INFO")
    print()

    try:
        success, fail, skip = upload_directory(repo_full_name)
    except Exception as e:
        log(f"上传过程出错: {e}", "ERROR")
        sys.exit(1)

    # 清理远程多余文件（可选，默认不执行）
    # 如果需要清理，取消下面注释：
    # local_paths = set()
    # for file_path in SOURCE_DIR.rglob("*"):
    #     if file_path.is_file() and not should_exclude(file_path):
    #         rel_path = str(file_path.relative_to(SOURCE_DIR)).replace("\\", "/")
    #         local_paths.add(rel_path)
    # delete_obsolete_files(repo_full_name, local_paths)

    # 输出结果
    print()
    print("=" * 60)
    log(f"上传完成！", "SUCCESS")
    log(f"  成功: {success} 个文件", "SUCCESS" if success > 0 else "INFO")
    log(f"  失败: {fail} 个文件", "ERROR" if fail > 0 else "INFO")
    log(f"  跳过: {skip} 个文件（未变更）", "INFO")
    log(f"仓库地址: https://github.com/{repo_full_name}", "INFO")
    print("=" * 60)


if __name__ == "__main__":
    main()
