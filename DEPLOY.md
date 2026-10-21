# 部署

构建产物是 `out/` —— 一个纯静态文件夹（约 940 KB），没有服务端、没有数据库、没有环境变量。
任何静态托管都能跑：GitHub Pages、Netlify、Vercel、Cloudflare Pages、对象存储、
或者直接扔进 Nginx 的目录。

## 一、先在本地确认能跑

```bash
npm run serve      # = npm run build && node tools/serve.mjs
```

打开 http://localhost:4310 ，另外手机连同一 WiFi 可直接访问终端打印的
`network: http://192.168.x.x:4310` —— 这是最快的验证方式，不必先传到公网。

## 二、传到 GitHub Pages（子路径托管）

GitHub Pages 把项目放在 `https://<user>.github.io/<repo>/` 下，**根绝对路径会全部 404**，
所以构建时必须告诉 Next 基路径：

```bash
MSYS_NO_PATHCONV=1 BASE_PATH=/<repo> NEXT_PUBLIC_BASE_PATH=/<repo> npm run build
```

> `MSYS_NO_PATHCONV=1` 是 Git Bash 专用的：它会把 `/<repo>` 当成本机路径翻译成
> `C:/.../<repo>`。PowerShell / cmd / CI 里不需要这一段。

两个变量都要给：`BASE_PATH` 给 Next 用来改写资源 URL，`NEXT_PUBLIC_BASE_PATH`
给应用本身（manifest 与 Service Worker 注册路径）读取。

发布方式二选一：

**A. GitHub Actions（推荐）** 新建 `.github/workflows/deploy.yml`：

```yaml
name: deploy
on:
  push: { branches: [main] }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          BASE_PATH: /attention-lab
          NEXT_PUBLIC_BASE_PATH: /attention-lab
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: out }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages }
    steps:
      - uses: actions/deploy-pages@v4
```

仓库 Settings → Pages → Source 选 **GitHub Actions**。

**B. 直接推 `out/` 内容** 把 `out/` 里的文件提交到 `gh-pages` 分支根目录
（注意是内容，不是 `out` 目录本身）。

## 三、传到自己的域名（根路径托管）

```bash
npm run build     # 不带 BASE_PATH
```

把 `out/` 整个目录交上去即可。Nginx 只需注意两点：

```nginx
location / { try_files $uri $uri/ /index.html; }
location = /sw.js { add_header Cache-Control "no-cache"; }   # Service Worker 不许被缓存
```

## 四、平台要点对照

| 平台 | BASE_PATH | 上传目录 | 备注 |
|---|---|---|---|
| GitHub Pages | `/<repo>` | `out/` 内容 | 需 Actions 或 gh-pages 分支 |
| Netlify / Vercel | 留空 | `out` | 构建命令 `npm run build`，发布目录 `out` |
| Cloudflare Pages | 留空 | `out` | 同上 |
| 自有 Nginx / 对象存储 | 视路径而定 | `out/` | 见上方 nginx 配置 |

## 五、发布后必须验证的四件事

1. **样式是否加载**。CSS 404 表现为纯黑白文字，最常见的原因就是漏了 `BASE_PATH`。
2. **手机能打开并「添加到主屏幕」**。装完图标是否正确、有没有地址栏（即 standalone 生效）。
3. **控制台里 Service Worker 是否 registered**。没有它就不是离线可用。
4. **改一行文案后重新发布，打开页面确认是新版**。若还是旧的，说明有缓存层在中间。

## 六、注意事项

- **`public/sw.js` 改动后必须把里面的 `CACHE = 'attnlab-v1'` 版本号 +1**，
  否则老用户永远命中旧缓存，你会以为部署没生效。
- **`next dev`（开发模式）不注册 Service Worker**，这是刻意的：SW 挡在 dev server 前面
  会缓存旧模块，让热更新说谎。所以要验证离线能力必须用 `npm run serve` 或线上环境。
- `public/` 是**构建时快照**，新增文件后必须重新 build。
- `tools/make-icons.py` 改了图标后同样要重新 build。

## 数据在哪

全部在浏览器的 localStorage，键名 `attnlab.v1`。**没有服务端副本**，
清缓存或换设备就没了。「关于」页可以导出 JSON 自留。

换域名或换协议时 localStorage 不跟随迁移（协议也算 origin），
所以从 `localhost` 换到线上域名时，历史数据不会自动出现。
