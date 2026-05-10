module.exports = {
  apps: [{
    name: 'truth-dare-wheel-optimized',
    script: 'server.js',
    env: {
      PORT: 3101,
      // 管理后台登录密码,部署时请改成你自己的强密码
      ADMIN_PASSWORD: 'qiaodaxian233'
    }
  }]
};
