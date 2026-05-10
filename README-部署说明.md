# 真心话大冒险转盘:优化版

## 页面

- 大转盘页面(玩家):`/`
- 管理员登录:`/login.html`
- 导入控制台(需登录):`/admin.html`

> 玩家页不再外露后台入口。后台地址需要单独告诉管理员,且必须输入密码才能进入。

## 管理员密码

后台采用密码 + Cookie 会话保护,默认密码 `admin123`,**部署上线前务必修改**。

修改方式(任选其一):

1. PM2 部署:编辑根目录 `ecosystem.config.js`,把 `ADMIN_PASSWORD` 改成你自己的强密码,然后 `pm2 reload truth-dare-wheel-optimized --update-env`。
2. 直接 node 启动:`ADMIN_PASSWORD='你的强密码' node server.js`。
3. 宝塔面板 PM2 / 系统服务:在"添加环境变量"里设置 `ADMIN_PASSWORD`。

会话有效期 7 天,超过后会自动退回登录页;同 IP 连续输错 8 次会临时锁 5 分钟。
后台所有写接口(`POST /api/data`、`/api/reset`、`/api/broadcast`)和 `admin.html` 页面都受密码保护;玩家页只读取 `GET /api/data`,仍然公开。

## 本版优化

- 题目多时不再每一帧重绘所有文字，转盘会缓存成图片后旋转，60 条、100 条以上也更流畅。
- 题目较多时转盘上显示编号，完整题目在抽中后全屏弹窗显示。
- 全屏弹窗适配手机，支持“再抽一次”和“回主转盘”。
- 手机端降低粒子和彩带数量，减少卡顿。

## 宝塔 PM2

项目路径：`/www/wwwroot/truth-dare-wheel-optimized-3101`

启动文件：`server.js`

端口：`3101`

反向代理：`http://127.0.0.1:3101`

## 覆盖已有项目时注意

正式使用后，你导入的数据保存在：

`data/wheel-data.json`

如果你只是升级旧项目,建议覆盖这些文件:

- `server.js`(必须,新增了密码登录逻辑)
- `public/index.html`
- `public/admin.html`
- `public/admin.js`
- `public/common.js`
- `public/login.html`(新文件,登录页)
- `public/style.css`
- `public/wheel.js`
- `ecosystem.config.js`(若用 PM2)

升级后第一次访问 `/admin.html` 会自动跳到 `/login.html`,默认密码 `admin123`(请尽快改)。

不要覆盖 `data/wheel-data.json`,否则会丢失你已经导入的题库。


## 新增作者/赞赏信息

- 玩家页和导入控制台底部已新增作者链接、联系邮箱和赞赏码入口。
- 作者链接：https://v.douyin.com/R5E-sjGaqBY/
- 邮箱：9@3.com
- 赞赏码图片路径：public/assets/reward-code.jpg


本版更新：玩家页顶部箭头位置已放置“作者主页”和“赞赏码”按钮，点击赞赏码会弹出全屏赞赏码；手机端按钮会自动换行适配。
