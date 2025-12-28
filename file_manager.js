/**
 * Sub-Store Clash 覆写脚本
 * 整合了源模板的业务分组逻辑和参考模板的 Mihomo 特性
 */

function operator(config) {
  // 1. 基础配置 (参考自参考文件)
  const baseConfig = {
    'mixed-port': 7890,
    'allow-lan': true,
    'mode': 'rule',
    'log-level': 'info',
    'ipv6': false,
    'find-process-mode': 'strict',
    'unified-delay': true,
    'tcp-concurrent': true,
    'global-client-fingerprint': 'random',
    'profile': { 'store-selected': true, 'store-fake-ip': true },
    'sniffer': {
      enable: true,
      sniff: {
        HTTP: { ports: [80, '8080-8880'], 'override-destination': true },
        TLS: { ports: [443, 8443] },
        QUIC: { ports: [443, 8443] }
      },
      'skip-domain': ['Mijia Cloud', 'dlg.io.mi.com', '+.push.apple.com']
    },
    'dns': {
      enable: true,
      listen: '0.0.0.0:53',
      ipv6: false,
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '198.18.0.1/16',
      'nameserver': ['https://223.5.5.5/dns-query', 'https://dns.pub/dns-query'],
      'fake-ip-filter': ['+.*'] // 简化处理，或按需填入源文件的长列表
    }
  };

  // 2. 定义图标 (源文件)
  const icons = {
    area: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Area.png",
    final: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Final.png",
    telegram: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Telegram.png",
    openai: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/ChatGPT.png",
    youtube: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/YouTube.png",
    apple: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Apple_1.png",
    direct: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Direct.png",
    hk: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Hong_Kong.png",
    tw: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Taiwan.png",
    sg: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Singapore.png",
    jp: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/Japan.png",
    us: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/United_States.png",
    ai: "https://cdn.jsdelivr.net/gh/zuluion/Qure/IconSet/Color/AI.png"
  };

  // 3. 定义正则过滤器 (源文件逻辑)
  const regHK = '港|HK|HongKong|Hong Kong';
  const regTW = '台湾|TW|Taiwan';
  const regSG = '新加坡|SG|Singapore';
  const regJP = '日本|樱花|JP|Japan';
  const regUS = '美国|US|United States|America';
  const regKorea = '韩国|KR|Korean';
  const regUK = '英国|UK|Britain|England';

  // 4. 构建策略组
  const groups = [
    { name: '国外流量', type: 'select', proxies: ['🇭🇰 AIRPORT-HK', '🇨🇳 AIRPORT-TW', '🇸🇬 AIRPORT-SG', '🇯🇵 AIRPORT-JP', '🇺🇸 AIRPORT-US', '其他流量'], icon: icons.area },
    { name: '其他流量', type: 'select', includeAll: true, icon: icons.final },
    { name: 'Telegram', type: 'select', proxies: ['国外流量', '🇭🇰 AIRPORT-HK', '🇸🇬 AIRPORT-SG', '🇯🇵 AIRPORT-JP', '🇺🇸 AIRPORT-US'], icon: icons.telegram },
    { name: 'OpenAI', type: 'select', proxies: ['🇰🇷 AIRPORT-Korea', '🇺🇸 AIRPORT-US', '🇯🇵 AIRPORT-JP', '🇸🇬 AIRPORT-SG', '🇬🇧 AIRPORT-EN'], icon: icons.openai },
    { name: 'YouTube', type: 'select', proxies: ['国外流量', '🇭🇰 AIRPORT-HK', '🇺🇸 AIRPORT-US'], icon: icons.youtube },
    { name: 'Apple', type: 'select', proxies: ['DIRECT', '国外流量', '🇺🇸 AIRPORT-US'], icon: icons.apple },
    
    // 自动选择/区域分组 (Mihomo 自动包含订阅节点)
    { name: '🇭🇰 AIRPORT-HK', type: 'url-test', filter: regHK, includeAll: true, url: 'http://www.gstatic.com/generate_204', interval: 300 },
    { name: '🇨🇳 AIRPORT-TW', type: 'url-test', filter: regTW, includeAll: true, url: 'http://www.gstatic.com/generate_204', interval: 300 },
    { name: '🇸🇬 AIRPORT-SG', type: 'url-test', filter: regSG, includeAll: true, url: 'http://www.gstatic.com/generate_204', interval: 300 },
    { name: '🇯🇵 AIRPORT-JP', type: 'url-test', filter: regJP, includeAll: true, url: 'http://www.gstatic.com/generate_204', interval: 300 },
    { name: '🇺🇸 AIRPORT-US', type: 'url-test', filter: regUS, includeAll: true, url: 'http://www.gstatic.com/generate_204', interval: 300 },
    { name: '🇰🇷 AIRPORT-Korea', type: 'url-test', filter: regKorea, includeAll: true, url: 'http://www.gstatic.com/generate_204', interval: 300 },
    { name: '🇬🇧 AIRPORT-EN', type: 'url-test', filter: regUK, includeAll: true, url: 'http://www.gstatic.com/generate_204', interval: 300 },
    { name: '直接连接', type: 'select', proxies: ['DIRECT'], hidden: true },
  ];

  // 5. 规则集 (Rule Providers)
  const ruleProviders = {
    'OpenAI': { type: 'http', behavior: 'classical', url: 'https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/OpenAI.yaml', path: './rules/openai.yaml', interval: 86400 },
    'YouTube': { type: 'http', behavior: 'classical', url: 'https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/YouTube.yaml', path: './rules/youtube.yaml', interval: 86400 },
    'Telegram': { type: 'http', behavior: 'classical', url: 'https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Telegram.yaml', path: './rules/telegram.yaml', interval: 86400 },
    'Apple': { type: 'http', behavior: 'classical', url: 'https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Apple.yaml', path: './rules/apple.yaml', interval: 86400 }
  };

  // 6. 规则列表
  const rules = [
    'RULE-SET,OpenAI,OpenAI',
    'RULE-SET,Telegram,Telegram',
    'RULE-SET,YouTube,YouTube',
    'RULE-SET,Apple,Apple',
    'GEOIP,CN,DIRECT',
    'MATCH,其他流量'
  ];

  // 合并到最终配置
  return {
    ...baseConfig,
    proxies: config.proxies, // 保留 Sub-Store 处理后的节点
    'proxy-groups': groups,
    'rule-providers': ruleProviders,
    rules: rules
  };
}