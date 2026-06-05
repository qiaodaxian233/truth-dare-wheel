module.exports = {
  apps: [{
    name: 'truth-dare-wheel-optimized',
    script: 'server.js',
    env: {
      PORT: 3101,
      // 管理后台登录密码,部署时请改成你自己的强密码
      ADMIN_PASSWORD: 'qiaodaxian233',
      // ===== 海龟汤 AI 主持人(qwen2API)=====
      QWEN_BASE: 'http://127.0.0.1:7860',
      QWEN_KEY: 'PUT_YOUR_QWEN_API_KEY_HERE',  // ← pull 下来后改成你 qwen2API 后台签发的真实 Key
      QWEN_MODEL: 'qwen3.6-plus'
    }
  }]
};
