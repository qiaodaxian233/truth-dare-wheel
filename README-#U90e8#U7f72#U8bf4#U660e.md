# 真心话大冒险转盘：优化版

## 页面

- 大转盘页面：`/`
- 导入控制台：`/admin.html`

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

如果你只是升级旧项目，建议只覆盖这些文件：

- `public/index.html`
- `public/style.css`
- `public/wheel.js`
- `public/common.js`

不要覆盖 `data/wheel-data.json`，否则会丢失你已经导入的题库。


## 新增作者/赞赏信息

- 玩家页和导入控制台底部已新增作者链接、联系邮箱和赞赏码入口。
- 作者链接：https://v.douyin.com/R5E-sjGaqBY/
- 邮箱：9@3.com
- 赞赏码图片路径：public/assets/reward-code.jpg


本版更新：玩家页顶部箭头位置已放置“作者主页”和“赞赏码”按钮，点击赞赏码会弹出全屏赞赏码；手机端按钮会自动换行适配。
