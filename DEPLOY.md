# iBoat网盘部署文档

作者：BOATZHOU

本文档面向普通 VPS / 云服务器部署，推荐架构是：

```text
用户浏览器
  ↓
Nginx 80/443
  ↓
127.0.0.1:3000
  ↓
iBoat网盘 Node 服务
  ↓
服务器本地文件目录
```

Node 负责页面、目录列表、密码校验和下载鉴权；Nginx 负责公网入口、HTTPS 和大文件传输。

## 1. 项目目录说明

当前项目结构：

```text
iboat-pan/
├─ config/
│  └─ site.json                 # 站点标题、频道链接、加密目录配置
├─ deploy/
│  └─ nginx-iboat-pan.conf      # Nginx 示例配置
├─ public/
│  ├─ app.js                    # 前端交互、路由、文件类型图标映射
│  ├─ index.html                # 页面结构、页脚免责声明
│  ├─ styles.css                # 视觉样式、响应式、深色模式
│  └─ icons/
│     ├─ brand/                 # favicon、logo
│     ├─ content/               # 文件夹、空目录等内容图标
│     ├─ files/                 # 文件类型图标
│     └─ nav/                   # 返回、刷新、下载、进入箭头
├─ storage/                     # 本地开发默认文件目录
├─ package.json
├─ README.md
└─ server.mjs                   # 后端服务
```

生产环境建议把真实文件存储目录放到项目外，例如：

```text
/opt/iboat-pan                 # 项目代码
/data/iboat-pan/storage        # 网盘文件
```

不要把 `PAN_ROOT` 指向项目根目录，避免误暴露源码、配置、部署脚本。

## 2. 环境要求

推荐：

- Linux VPS，例如 Debian / Ubuntu / Rocky / AlmaLinux
- Node.js 18 或更高版本
- Nginx
- 一个域名，例如 `pan.example.com`
- HTTPS 证书，推荐使用 Certbot 或服务器面板自动申请

检查 Node：

```bash
node -v
npm -v
```

项目没有第三方 npm 依赖，因此不需要安装依赖包也能运行。

## 3. 上传项目到服务器

示例路径：

```bash
sudo mkdir -p /opt/iboat-pan
sudo mkdir -p /data/iboat-pan/storage
```

把项目文件上传到：

```text
/opt/iboat-pan
```

把网盘文件放到：

```text
/data/iboat-pan/storage
```

示例：

```bash
cd /opt/iboat-pan
ls
```

应该能看到：

```text
config  deploy  public  storage  package.json  server.mjs
```

## 4. 本地试运行

进入项目目录：

```bash
cd /opt/iboat-pan
```

启动：

```bash
HOST=127.0.0.1 \
PORT=3000 \
PAN_ROOT=/data/iboat-pan/storage \
PAN_SECRET='请换成一段足够长的随机字符串' \
npm start
```

如果只是本地临时测试，也可以在项目目录直接：

```bash
npm start
```

默认使用：

```text
HOST=127.0.0.1
PORT=3000
PAN_ROOT=项目目录/storage
```

浏览器访问：

```text
http://服务器IP:3000
```

注意：生产环境不建议公网开放 3000 端口。正式上线应只开放 Nginx 的 80/443。

## 4.1 1Panel 非 Docker 部署要点

如果你使用 1Panel，但不想用 Docker，可以按普通 VPS 方式部署：

1. 在 1Panel “终端”里安装 Node.js 18+。
2. 把项目上传到 `/opt/iboat-pan`。
3. 把文件放到 `/data/iboat-pan/storage`。
4. 用 systemd 或 PM2 让 Node 服务常驻运行。
5. 在 1Panel “网站”里创建反向代理，目标写：

```text
http://127.0.0.1:3000
```

Node 服务仍然建议只监听：

```text
127.0.0.1:3000
```

公网只暴露 1Panel 管理的 Nginx/OpenResty 网站端口，也就是 `80/443`。

## 5. 环境变量说明

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | Node 监听地址。同机 Nginx 推荐保持默认 |
| `PAN_HOST` | 空 | `HOST` 的备用写法 |
| `PORT` | `3000` | Node 端口 |
| `PAN_ROOT` | `项目目录/storage` | 网盘文件真实存储目录 |
| `PAN_SECRET` | `change-this-secret-in-production` | 解锁 cookie 签名密钥，生产必须修改 |
| `PAN_X_ACCEL` | 空 | 设置为 `1` 开启 Nginx 大文件下载优化 |
| `PAN_X_ACCEL_PREFIX` | `/_iboat_files/` | Nginx 内部下载路径，必须和 Nginx 配置一致 |

生产推荐：

```bash
HOST=127.0.0.1
PORT=3000
PAN_ROOT=/data/iboat-pan/storage
PAN_SECRET=一段随机长字符串
PAN_X_ACCEL=1
PAN_X_ACCEL_PREFIX=/_iboat_files/
```

如果 Nginx 和 Node 不在同一台机器时，可能需要：

```bash
HOST=0.0.0.0
```

普通 VPS + 同机 Nginx 不需要这样做。

## 6. Nginx 反向代理

项目内已有示例：

```text
deploy/nginx-iboat-pan.conf
```

基础配置：

```nginx
server {
    listen 80;
    server_name pan.example.com;

    client_max_body_size 0;

    location /_iboat_files/ {
        internal;
        alias /data/iboat-pan/storage/;
        add_header X-Content-Type-Options nosniff always;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

关键点：

- `proxy_pass` 指向 Node：`http://127.0.0.1:3000`
- `/_iboat_files/` 是内部下载路径，必须保留 `internal`
- `alias /data/iboat-pan/storage/;` 必须和 `PAN_ROOT` 指向同一个目录
- `internal` 可以防止用户绕过 Node 鉴权直接下载文件

复制配置：

```bash
sudo cp /opt/iboat-pan/deploy/nginx-iboat-pan.conf /etc/nginx/sites-available/iboat-pan.conf
sudo ln -s /etc/nginx/sites-available/iboat-pan.conf /etc/nginx/sites-enabled/iboat-pan.conf
```

测试 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 开启 Nginx 大文件下载优化

不优化时，下载链路是：

```text
浏览器 ← Node 读取文件并输出
```

开启 `X-Accel-Redirect` 后：

```text
浏览器 ← Nginx 读取文件并输出
              ↑
        Node 只做鉴权
```

生产启动时加：

```bash
PAN_X_ACCEL=1
PAN_X_ACCEL_PREFIX=/_iboat_files/
```

Nginx 配置必须有：

```nginx
location /_iboat_files/ {
    internal;
    alias /data/iboat-pan/storage/;
}
```

验证方式：

```bash
curl -I "http://127.0.0.1:3000/download?path=测试文件.txt"
```

开启后应能看到类似：

```text
x-accel-redirect: /_iboat_files/测试文件.txt
```

通过域名访问时，Nginx 会接管这个内部路径并发送真实文件。

## 8. 使用 systemd 常驻运行

创建服务文件：

```bash
sudo nano /etc/systemd/system/iboat-pan.service
```

内容：

```ini
[Unit]
Description=iBoat Pan
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/iboat-pan
ExecStart=/usr/bin/node /opt/iboat-pan/server.mjs
Restart=always
RestartSec=3
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=PAN_ROOT=/data/iboat-pan/storage
Environment=PAN_SECRET=请换成一段足够长的随机字符串
Environment=PAN_X_ACCEL=1
Environment=PAN_X_ACCEL_PREFIX=/_iboat_files/

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable iboat-pan
sudo systemctl start iboat-pan
```

查看状态：

```bash
sudo systemctl status iboat-pan
```

查看日志：

```bash
journalctl -u iboat-pan -f
```

重启：

```bash
sudo systemctl restart iboat-pan
```

## 9. 使用 PM2 常驻运行

如果你习惯 PM2：

```bash
npm install -g pm2
```

启动：

```bash
cd /opt/iboat-pan
HOST=127.0.0.1 \
PORT=3000 \
PAN_ROOT=/data/iboat-pan/storage \
PAN_SECRET='请换成一段足够长的随机字符串' \
PAN_X_ACCEL=1 \
PAN_X_ACCEL_PREFIX=/_iboat_files/ \
pm2 start server.mjs --name iboat-pan
```

保存：

```bash
pm2 save
pm2 startup
```

查看：

```bash
pm2 logs iboat-pan
pm2 status
```

## 10. HTTPS

推荐使用 Certbot：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d pan.example.com
```

完成后，Nginx 会自动增加 443 配置。

如果使用宝塔、1Panel、Nginx Proxy Manager 等面板，直接在面板里给站点申请证书即可。

## 11. 安全建议

### 11.1 存储目录不要放敏感配置

正确：

```text
/opt/iboat-pan                 # 项目代码
/data/iboat-pan/storage        # 文件存储
```

错误：

```text
PAN_ROOT=/opt/iboat-pan
```

### 11.2 隐藏路径已被拒绝

后端会拒绝：

```text
.env
.git/config
folder/.secret.txt
```

接口会返回：

```text
403 Forbidden
```

### 11.3 防软链接逃逸

后端会用 `realpath` 校验真实路径。

如果存储目录中出现软链接或 junction 指向外部路径，例如：

```text
/data/iboat-pan/storage/link -> /etc
```

访问会返回：

```text
403 Forbidden
```

### 11.4 Node 端口不要暴露公网

推荐：

```text
Node: 127.0.0.1:3000
Nginx: 80/443
```

防火墙只开放：

```text
80
443
22
```

不要开放：

```text
3000
```

### 11.5 Nginx internal 必须保留

这段不能删：

```nginx
internal;
```

否则用户可能直接访问：

```text
/_iboat_files/xxx.zip
```

绕过 Node 的加密目录校验。

## 12. 站点基础配置如何手动修改

主要配置文件：

```text
config/site.json
```

当前示例：

```json
{
  "title": "iBoat网盘",
  "channelLabel": "关注TG频道",
  "channelUrl": "",
  "unlockMaxAgeSeconds": 1800,
  "protected": {
    "加密文件夹": {
      "password": "123456"
    }
  }
}
```

### 12.1 修改站点名称

改：

```json
"title": "iBoat网盘"
```

如果你想改默认 fallback，也可以同步改：

```text
server.mjs
public/index.html
public/app.js
README.md
```

### 12.2 修改 TG 频道按钮

改：

```json
"channelLabel": "关注TG频道",
"channelUrl": "https://t.me/your_channel"
```

如果 `channelUrl` 为空，按钮会隐藏。

### 12.3 修改加密目录

例如想让 `私密/软件` 加密：

```json
"protected": {
  "私密/软件": {
    "password": "your-password"
  }
}
```

注意：key 是相对 `PAN_ROOT` 的路径。

### 12.4 修改解锁有效期

当前：

```json
"unlockMaxAgeSeconds": 1800
```

表示 30 分钟。

不过前端已经做了“离开加密目录自动忘记解锁状态”，所以这个值主要是兜底。

## 13. 品牌资源如何手动修改

图标目录：

```text
public/icons/brand/
```

包含：

```text
favicon.ico
logo.svg
```

替换 favicon：

```text
public/icons/brand/favicon.ico
```

替换顶部 Logo：

```text
public/icons/brand/logo.svg
```

引用位置：

```text
public/index.html
```

相关样式：

```text
public/styles.css
```

类名：

```css
.brand-logo
```

## 14. 文件类型图标如何手动修改

当前文件类型图标使用 iconfont Symbol，不再使用 `public/icons/files/` 下的独立 SVG 文件。

Symbol 脚本在：

```text
public/index.html
```

搜索：

```html
font_5187706_p0cabicnl8p.js
```

映射逻辑在：

```text
public/app.js
```

搜索：

```js
fileIconGroups
```

例如添加 `.iso` 使用压缩包图标：

```js
{ icon: "zip", extensions: ["zip", "rar", "7z", "iso"] }
```

这里的 `icon` 会拼成 Symbol ID，例如 `zip` 会引用：

```text
#iboat-zip
```

如果某个扩展名没有命中，会使用默认图标：

```text
#iboat-file
```

## 15. 文件夹和导航图标如何手动修改

文件夹和导航图标也使用 iconfont Symbol，不再使用独立 SVG 文件。

常用 Symbol ID：

```text
#iboat-folder
#iboat-folder-locked
#iboat-chevron-left
#iboat-chevron-right
#iboat-refresh
#iboat-download
```

引用位置：

```text
public/index.html
public/app.js
```

## 16. 页脚版权和免责声明如何手动修改

页脚内容在：

```text
public/index.html
```

搜索：

```html
<footer class="site-footer glass">
```

版权年份由前端自动填写：

```text
public/app.js
```

搜索：

```js
data-year
```

页脚样式在：

```text
public/styles.css
```

搜索：

```css
.site-footer
```

## 17. 深色模式如何修改或关闭

深色模式在：

```text
public/styles.css
```

搜索：

```css
@media (prefers-color-scheme: dark)
```

如果你想完全关闭深色模式，删除这一整段即可。

如果只想调整深色模式颜色，在这一段中修改 CSS 变量。

## 18. 路径 URL 规则

当前使用干净路径：

```text
/动漫
/动漫/二级文件夹
```

不再兼容旧格式：

```text
/?path=动漫
```

前端读取路径的位置：

```text
public/app.js
```

搜索：

```js
readPathFromLocation
```

后端负责把目录路径返回前端入口页面：

```text
server.mjs
```

搜索：

```js
serveIndex
```

## 19. 更新项目

推荐流程：

```bash
cd /opt/iboat-pan
```

备份配置：

```bash
cp config/site.json config/site.json.bak
```

替换项目文件后，重启：

```bash
sudo systemctl restart iboat-pan
```

或 PM2：

```bash
pm2 restart iboat-pan
```

Nginx 配置有变化时：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 20. 常见问题

### 20.1 页面打不开

检查 Node：

```bash
sudo systemctl status iboat-pan
```

检查 Nginx：

```bash
sudo nginx -t
sudo systemctl status nginx
```

检查端口：

```bash
ss -lntp | grep 3000
```

正常情况下应看到：

```text
127.0.0.1:3000
```

### 20.2 下载 404

检查：

- 文件是否真的存在于 `PAN_ROOT`
- URL 中的路径是否正确
- 文件名大小写是否一致
- Nginx `alias` 是否指向同一个目录

### 20.3 开启 X-Accel 后无法下载

重点检查：

```nginx
location /_iboat_files/ {
    internal;
    alias /data/iboat-pan/storage/;
}
```

`alias` 结尾建议保留 `/`。

同时确认 Node：

```bash
PAN_X_ACCEL=1
PAN_X_ACCEL_PREFIX=/_iboat_files/
```

### 20.4 加密目录正确密码后还是进不去

检查浏览器是否禁用 cookie。

检查 `PAN_SECRET` 是否在服务重启中频繁变化。生产环境应固定 `PAN_SECRET`。

### 20.5 返回上一级后再次进入又要密码

这是当前设计。

加密目录是临时通行，离开加密目录后前端会调用 `/api/forget` 清除解锁状态。

### 20.6 favicon 没更新

浏览器会强缓存 favicon。

可以尝试：

- 强制刷新
- 关闭标签页重新打开
- 清理站点缓存
- 临时改 favicon 文件名并更新 `public/index.html`

## 21. 上线前检查清单

- [ ] `PAN_ROOT` 指向项目外部的独立存储目录
- [ ] `PAN_SECRET` 已改成随机长字符串
- [ ] Node 只监听 `127.0.0.1`
- [ ] 服务器防火墙没有开放 `3000`
- [ ] Nginx `proxy_pass` 指向 `127.0.0.1:3000`
- [ ] Nginx `/_iboat_files/` 配置了 `internal`
- [ ] Nginx `alias` 和 `PAN_ROOT` 指向同一个目录
- [ ] 已配置 HTTPS
- [ ] 已测试普通目录、加密目录、文件下载
- [ ] 已确认页脚版权和免责声明内容
- [ ] 已备份 `config/site.json`
