#!/usr/bin/env python3
"""准备 WebView 资产：复制仓库 web 代码 + 本地化 CDN 依赖 + 注入原生桥。"""
import os, shutil, subprocess, sys

REPO = "/workspace"
APP_ASSETS = "/workspace/android/app/assets"
WWW = os.path.join(APP_ASSETS, "www")
VENDOR = os.path.join(WWW, "vendor")

CDN = [
    # (url, 本地相对路径)
    ("https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js", "localforage.min.js"),
    ("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "jszip.min.js"),
    ("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css", "fontawesome/all.min.css"),
    ("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2", "webfonts/fa-solid-900.woff2"),
    ("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2", "webfonts/fa-regular-400.woff2"),
    ("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2", "webfonts/fa-brands-400.woff2"),
    ("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-v4compatibility.woff2", "webfonts/fa-v4compatibility.woff2"),
    ("https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css", "tabler/tabler-icons.min.css"),
    ("https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/fonts/tabler-icons.woff2", "tabler/fonts/tabler-icons.woff2"),
    ("https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/fonts/tabler-icons.woff", "tabler/fonts/tabler-icons.woff"),
]

REPLACEMENTS = [
    ('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">',
     '<link rel="stylesheet" href="vendor/fontawesome/all.min.css">'),
    ('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css">',
     '<link rel="stylesheet" href="vendor/tabler/tabler-icons.min.css">'),
    ('<script src="https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js"></script>',
     '<script src="vendor/localforage.min.js"></script>'),
    ('<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>',
     '<script src="vendor/jszip.min.js"></script>'),
]

BRIDGE_TAG = '<script src="js/native-bridge.js"></script>'
JSZIP_LOCAL = '<script src="vendor/jszip.min.js"></script>'

def main():
    # 1. 复制仓库 web 代码
    os.makedirs(WWW, exist_ok=True)
    for item in ["index.html", "css", "js", "assets"]:
        src = os.path.join(REPO, item)
        dst = os.path.join(WWW, item)
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    # 2. 下载 CDN 依赖到本地
    os.makedirs(VENDOR, exist_ok=True)
    ok, fail = 0, []
    for url, rel in CDN:
        path = os.path.join(VENDOR, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        r = subprocess.run(["curl", "-sSL", "--retry", "3", "-o", path, url],
                           capture_output=True)
        if r.returncode != 0 or os.path.getsize(path) < 100:
            fail.append(rel)
        else:
            ok += 1
    print(f"vendor: {ok} ok, fail={fail}")
    if fail:
        sys.exit(1)

    # 3. 注入原生桥脚本
    bridge_src = "/workspace/android/app/assets.patch/native-bridge.js"
    shutil.copy2(bridge_src, os.path.join(WWW, "js", "native-bridge.js"))

    # 4. 修改 index.html
    idx = os.path.join(WWW, "index.html")
    with open(idx, "r", encoding="utf-8") as f:
        html = f.read()
    for old, new in REPLACEMENTS:
        if old in html:
            html = html.replace(old, new)
        else:
            print("WARN: not found ->", old[:70])
    if BRIDGE_TAG not in html:
        html = html.replace(JSZIP_LOCAL, JSZIP_LOCAL + '\n    ' + BRIDGE_TAG, 1)
    with open(idx, "w", encoding="utf-8") as f:
        f.write(html)
    print("assets ready")

if __name__ == "__main__":
    main()
