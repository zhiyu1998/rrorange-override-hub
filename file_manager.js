/*
RrOrange 的 Substore 订阅转换脚本
https://github.com/zhiyu1998/rrorange-override-hub

支持的传入参数：
- loadbalance: 启用负载均衡（url-test/load-balance，默认 false）
- landing: 启用落地节点功能（如机场家宽/星链/落地分组，默认 false）
- ipv6: 启用 IPv6 支持（默认 false）
- full: 输出完整配置（适合纯内核启动，默认 false）
- keepalive: 启用 tcp-keep-alive（默认 false）
- fakeip: DNS 使用 FakeIP 模式（默认 false，false 为 RedirHost）
- quic: 允许 QUIC 流量（UDP 443，默认 false）
- threshold: 国家节点数量小于该值时不显示分组 (默认 0)
*/

const NODE_SUFFIX = "节点";

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return false;
}

function parseNumber(value, defaultValue = 0) {
  if (value === null || typeof value === 'undefined') {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 解析传入的脚本参数，并将其转换为内部使用的功能开关（feature flags）。
 * @param {object} args - 传入的原始参数对象，如 $arguments。
 * @returns {object} - 包含所有功能开关状态的对象。
 *
 * 该函数通过一个 `spec` 对象定义了外部参数名（如 `loadbalance`）到内部变量名（如 `loadBalance`）的映射关系。
 * 它会遍历 `spec` 中的每一项，对 `args` 对象中对应的参数值调用 `parseBool` 函数进行布尔化处理，
 * 并将结果存入返回的对象中。
 */
function buildFeatureFlags(args) {
  const spec = {
    loadbalance: "loadBalance",
    landing: "landing",
    ipv6: "ipv6Enabled",
    full: "fullConfig",
    keepalive: "keepAliveEnabled",
    fakeip: "fakeIPEnabled",
    quic: "quicEnabled"
  };

  const flags = Object.entries(spec).reduce((acc, [sourceKey, targetKey]) => {
    acc[targetKey] = parseBool(args[sourceKey]) || false;
    return acc;
  }, {});

  // 单独处理数字参数
  flags.countryThreshold = parseNumber(args.threshold, 0);

  return flags;
}

const rawArgs = typeof $arguments !== 'undefined' ? $arguments : {};
const {
  loadBalance,
  landing,
  ipv6Enabled,
  fullConfig,
  keepAliveEnabled,
  fakeIPEnabled,
  quicEnabled,
  countryThreshold
} = buildFeatureFlags(rawArgs);

function getCountryGroupNames(countryInfo, minCount) {
  return countryInfo
    .filter(item => item.count >= minCount)
    .map(item => item.country + NODE_SUFFIX);
}

function stripNodeSuffix(groupNames) {
  const suffixPattern = new RegExp(`${NODE_SUFFIX}$`);
  return groupNames.map(name => name.replace(suffixPattern, ""));
}

const PROXY_GROUPS = {
  SELECT: "选择代理",
  MANUAL: "手动选择",
  FALLBACK: "故障转移",
  DIRECT: "直连",
  LANDING: "落地节点",
  LOW_COST: "低倍率节点",
};

// 各服务的国家节点优先级配置
const SERVICE_PRIORITY = {
  OpenAI: ["韩国", "日本", "美国", "新加坡", "英国", "爱尔兰", "加拿大", "法国", "澳大利亚"],
  Claude: ["英国", "美国", "韩国", "日本", "新加坡", "爱尔兰", "加拿大", "法国", "澳大利亚"],
  Gemini: ["美国", "英国", "韩国", "日本", "新加坡", "爱尔兰", "加拿大", "法国", "澳大利亚"],
  Perplexity: ["美国", "英国", "韩国", "日本", "新加坡", "爱尔兰", "加拿大", "法国", "澳大利亚"],
  Google: ["美国", "英国", "韩国", "日本", "新加坡", "爱尔兰", "加拿大", "法国", "澳大利亚"],
  TikTok: ["美国", "日本", "韩国", "新加坡"],
  Reddit: ["美国"],
  JavSP: ["日本"]
};

// 辅助函数，用于根据条件构建数组，自动过滤掉无效值（如 false, null）
const buildList = (...elements) => elements.flat().filter(Boolean);

/**
 * 为特定服务构建带优先级的代理列表
 * @param {object} options - 配置选项
 * @param {string[]} options.priorityCountries - 优先的国家/地区列表（按优先级排序）
 * @param {string[]} options.countryGroupNames - 所有可用的国家分组名称
 * @param {boolean} options.lowCost - 是否有低倍率节点
 * @returns {string[]} - 排序后的代理列表
 */
function buildServiceProxies({ priorityCountries, countryGroupNames, lowCost }) {
  const orderedCountries = [];

  // 先添加优先级国家（如果存在于节点列表中）
  for (const country of priorityCountries) {
    const groupName = country + NODE_SUFFIX;
    if (countryGroupNames.includes(groupName)) {
      orderedCountries.push(groupName);
    }
  }

  // 添加其他国家
  for (const groupName of countryGroupNames) {
    if (!orderedCountries.includes(groupName)) {
      orderedCountries.push(groupName);
    }
  }

  return buildList(
    orderedCountries,
    PROXY_GROUPS.SELECT,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL
  );
}

function buildBaseLists({ landing, lowCost, countryGroupNames }) {
  // 使用辅助函数和常量，以声明方式构建各个代理列表

  // “选择节点”组的候选列表
  const defaultSelector = buildList(
    PROXY_GROUPS.FALLBACK,
    landing && PROXY_GROUPS.LANDING,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    "DIRECT"
  );

  // 默认的代理列表，用于大多数策略组
  const defaultProxies = buildList(
    PROXY_GROUPS.SELECT,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    PROXY_GROUPS.DIRECT
  );

  // “直连”优先的代理列表
  const defaultProxiesDirect = buildList(
    PROXY_GROUPS.DIRECT,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.SELECT,
    PROXY_GROUPS.MANUAL
  );

  // “故障转移”组的代理列表
  const defaultFallback = buildList(
    landing && PROXY_GROUPS.LANDING,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    "DIRECT"
  );

  return { defaultProxies, defaultProxiesDirect, defaultSelector, defaultFallback };
}

const ruleProviders = {
  // 广告拦截
  "AdBlock": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/AdBlock.yaml",
    "path": "./ruleset/AdBlock.yaml"
  },
  "AWAvenue-Ads-Rule": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/AWAvenue-Ads-Rule.yaml",
    "path": "./ruleset/AWAvenue-Ads-Rule.yaml"
  },
  // AI 服务
  "OpenAI": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/OpenAI.yaml",
    "path": "./ruleset/OpenAI.yaml"
  },
  "Claude": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Claude.yaml",
    "path": "./ruleset/Claude.yaml"
  },
  "Gemini": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Gemini.yaml",
    "path": "./ruleset/Gemini.yaml"
  },
  "Perplexity": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Perplexity.yaml",
    "path": "./ruleset/Perplexity.yaml"
  },
  "Copilot": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Copilot.yaml",
    "path": "./ruleset/Copilot.yaml"
  },
  // 流媒体
  "Netflix": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Netflix.yaml",
    "path": "./ruleset/Netflix.yaml"
  },
  "YouTube": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/YouTube.yaml",
    "path": "./ruleset/YouTube.yaml"
  },
  "TikTok": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/TikTok.yaml",
    "path": "./ruleset/TikTok.yaml"
  },
  "Bilibili": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Bilibili.yaml",
    "path": "./ruleset/Bilibili.yaml"
  },
  "Spotify": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Spotify.yaml",
    "path": "./ruleset/Spotify.yaml"
  },
  "DisneyPlus": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/DisneyPlus.yaml",
    "path": "./ruleset/DisneyPlus.yaml"
  },
  "Hulu": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Hulu.yaml",
    "path": "./ruleset/Hulu.yaml"
  },
  "HBO": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/HBO.yaml",
    "path": "./ruleset/HBO.yaml"
  },
  // 社交媒体
  "Telegram": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Telegram.yaml",
    "path": "./ruleset/Telegram.yaml"
  },
  "Discord": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Discord.yaml",
    "path": "./ruleset/Discord.yaml"
  },
  "Facebook": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Facebook.yaml",
    "path": "./ruleset/Facebook.yaml"
  },
  "Twitter": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Twitter.yaml",
    "path": "./ruleset/Twitter.yaml"
  },
  "Reddit": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Reddit.yaml",
    "path": "./ruleset/Reddit.yaml"
  },
  // 企业服务
  "Apple": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Apple.yaml",
    "path": "./ruleset/Apple.yaml"
  },
  "Adobe": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Adobe.yaml",
    "path": "./ruleset/Adobe.yaml"
  },
  "Amazon": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Amazon.yaml",
    "path": "./ruleset/Amazon.yaml"
  },
  "Microsoft": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Microsoft.yaml",
    "path": "./ruleset/Microsoft.yaml"
  },
  "OneDrive": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/OneDrive.yaml",
    "path": "./ruleset/OneDrive.yaml"
  },
  "OutLook": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/OutLook.yaml",
    "path": "./ruleset/OutLook.yaml"
  },
  "Google": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Google.yaml",
    "path": "./ruleset/Google.yaml"
  },
  "GitHub": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/GitHub.yaml",
    "path": "./ruleset/GitHub.yaml"
  },
  // 游戏/下载
  "Steam": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Steam.yaml",
    "path": "./ruleset/Steam.yaml"
  },
  "Ubisoft": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Ubisoft.yaml",
    "path": "./ruleset/Ubisoft.yaml"
  },
  "Netch": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Netch.yaml",
    "path": "./ruleset/Netch.yaml"
  },
  "PikPak": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/PikPak.yaml",
    "path": "./ruleset/PikPak.yaml"
  },
  "JavSP": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/JavSP.yaml",
    "path": "./ruleset/JavSP.yaml"
  },
  // 其他
  "Speedtest": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Speedtest.yaml",
    "path": "./ruleset/Speedtest.yaml"
  },
  "PayPal": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/PayPal.yaml",
    "path": "./ruleset/PayPal.yaml"
  },
  "Tencent": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Tencent.yaml",
    "path": "./ruleset/Tencent.yaml"
  },
  "China": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/China.yaml",
    "path": "./ruleset/China.yaml"
  },
  "Proxy": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Proxy.yaml",
    "path": "./ruleset/Proxy.yaml"
  },
  "ProxyClient": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/ProxyClient.yaml",
    "path": "./ruleset/ProxyClient.yaml"
  },
  "Direct": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Direct.yaml",
    "path": "./ruleset/Direct.yaml"
  },
  "DownLoadClient": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/DownLoadClient.yaml",
    "path": "./ruleset/DownLoadClient.yaml"
  },
  "IDM": {
    "type": "http",
    "behavior": "classical",
    "interval": 3600,
    "url": "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/IDM.yaml",
    "path": "./ruleset/IDM.yaml"
  }
}

const baseRules = [
  // 直连规则（优先处理）
  `RULE-SET,DownLoadClient,${PROXY_GROUPS.DIRECT}`,
  `RULE-SET,ProxyClient,${PROXY_GROUPS.DIRECT}`,

  // 广告拦截
  `RULE-SET,AdBlock,广告拦截`,
  `RULE-SET,AWAvenue-Ads-Rule,广告拦截`,

  // AI 服务（细分）
  `RULE-SET,OpenAI,OpenAI`,
  `RULE-SET,Claude,Claude`,
  `RULE-SET,Gemini,Gemini`,
  `RULE-SET,Perplexity,Perplexity`,
  `RULE-SET,Copilot,Copilot`,

  // 企业服务
  `RULE-SET,Apple,Apple`,
  `RULE-SET,Adobe,${PROXY_GROUPS.SELECT}`,
  `RULE-SET,Amazon,Amazon`,
  `RULE-SET,GitHub,${PROXY_GROUPS.SELECT}`,
  `RULE-SET,Google,Google`,
  `RULE-SET,OneDrive,OneDrive`,
  `RULE-SET,OutLook,OutLook`,
  `RULE-SET,Microsoft,Microsoft`,

  // 流媒体
  `RULE-SET,Netflix,Netflix`,
  `RULE-SET,DisneyPlus,DisneyPlus`,
  `RULE-SET,Hulu,Hulu`,
  `RULE-SET,HBO,HBO`,
  `RULE-SET,TikTok,TikTok`,
  `RULE-SET,Speedtest,Speedtest`,
  `RULE-SET,Steam,Steam`,
  `RULE-SET,Ubisoft,Ubisoft`,
  `RULE-SET,Netch,Netch`,
  `RULE-SET,Spotify,Spotify`,
  `RULE-SET,PikPak,PikPak`,

  // 社交媒体
  `RULE-SET,Telegram,Telegram`,
  `RULE-SET,Twitter,${PROXY_GROUPS.SELECT}`,
  `RULE-SET,Tencent,${PROXY_GROUPS.DIRECT}`,
  `RULE-SET,YouTube,YouTube`,
  `RULE-SET,PayPal,PayPal`,
  `RULE-SET,Discord,Discord`,
  `RULE-SET,Facebook,Facebook`,
  `RULE-SET,Reddit,Reddit`,
  `RULE-SET,JavSP,JavSP`,
  `RULE-SET,IDM,IDM`,
  `RULE-SET,Bilibili,Bilibili`,

  // 代理/直连规则
  `RULE-SET,Proxy,${PROXY_GROUPS.SELECT}`,
  `RULE-SET,Direct,DIRECT`,

  // 地理位置规则
  `GEOIP,CN,DIRECT`,
  `MATCH,${PROXY_GROUPS.SELECT}`
];

function buildRules({ quicEnabled }) {
  const ruleList = [...baseRules];
  if (!quicEnabled) {
    // 屏蔽 QUIC 流量，避免网络环境 UDP 速度不佳时影响体验
    ruleList.unshift("AND,((DST-PORT,443),(NETWORK,UDP)),REJECT");
  }
  return ruleList;
}

const snifferConfig = {
  "sniff": {
    "TLS": {
      "ports": [443, 8443],
    },
    "HTTP": {
      "ports": [80, 8080, 8880],
    },
    "QUIC": {
      "ports": [443, 8443],
    }
  },
  "override-destination": false,
  "enable": true,
  "force-dns-mapping": true,
  "skip-domain": [
    "Mijia Cloud",
    "dlg.io.mi.com",
    "+.push.apple.com"
  ]
};

function buildDnsConfig({ mode, fakeIpFilter }) {
  const config = {
    "enable": true,
    "ipv6": ipv6Enabled,
    "prefer-h3": true,
    "enhanced-mode": mode,
    "default-nameserver": [
      "119.29.29.29",
      "223.5.5.5"
    ],
    "nameserver": [
      "system",
      "223.5.5.5",
      "119.29.29.29",
      "180.184.1.1"
    ],
    "fallback": [
      "quic://dns0.eu",
      "https://dns.cloudflare.com/dns-query",
      "https://dns.sb/dns-query",
      "tcp://208.67.222.222",
      "tcp://8.26.56.2"
    ],
    "proxy-server-nameserver": [
      "https://dns.alidns.com/dns-query",
      "tls://dot.pub"
    ]
  };

  if (fakeIpFilter) {
    config["fake-ip-filter"] = fakeIpFilter;
  }

  return config;
}

const dnsConfig = buildDnsConfig({ mode: "redir-host" });
const dnsConfigFakeIp = buildDnsConfig({
  mode: "fake-ip",
  fakeIpFilter: [
    "geosite:private",
    "geosite:connectivity-check",
    "geosite:cn",
    "Mijia Cloud",
    "dig.io.mi.com",
    "localhost.ptlogin2.qq.com",
    "*.icloud.com",
    "*.stun.*.*",
    "*.stun.*.*.*"
  ]
});

const geoxURL = {
  "geoip": "https://gcore.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat",
  "geosite": "https://gcore.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat",
  "mmdb": "https://gcore.jsdelivr.net/gh/Loyalsoldier/geoip@release/Country.mmdb",
  "asn": "https://gcore.jsdelivr.net/gh/Loyalsoldier/geoip@release/GeoLite2-ASN.mmdb"
};

// 地区元数据
const countriesMeta = {
  "香港": {
    pattern: "(?i)香港|港|HK|hk|Hong Kong|HongKong|hongkong|🇭🇰",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Hong_Kong.png"
  },
  "澳门": {
    pattern: "(?i)澳门|MO|Macau|🇲🇴",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Macao.png"
  },
  "台湾": {
    pattern: "(?i)台|新北|彰化|TW|Taiwan|🇹🇼",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Taiwan.png"
  },
  "新加坡": {
    pattern: "(?i)新加坡|坡|狮城|SG|Singapore|🇸🇬",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Singapore.png"
  },
  "日本": {
    pattern: "(?i)日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan|🇯🇵",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Japan.png"
  },
  "韩国": {
    pattern: "(?i)KR|Korea|KOR|首尔|韩|韓|🇰🇷",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Korea.png"
  },
  "美国": {
    pattern: "(?i)美国|美|US|United States|🇺🇸",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_States.png"
  },
  "加拿大": {
    pattern: "(?i)加拿大|Canada|CA|🇨🇦",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Canada.png"
  },
  "英国": {
    pattern: "(?i)英国|United Kingdom|UK|伦敦|London|🇬🇧",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_Kingdom.png"
  },
  "澳大利亚": {
    pattern: "(?i)澳洲|澳大利亚|AU|Australia|🇦🇺",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Australia.png"
  },
  "德国": {
    pattern: "(?i)德国|德|DE|Germany|🇩🇪",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Germany.png"
  },
  "法国": {
    pattern: "(?i)法国|法|FR|France|🇫🇷",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/France.png"
  },
  "俄罗斯": {
    pattern: "(?i)俄罗斯|俄|RU|Russia|🇷🇺",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Russia.png"
  },
  "泰国": {
    pattern: "(?i)泰国|泰|TH|Thailand|🇹🇭",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Thailand.png"
  },
  "印度": {
    pattern: "(?i)印度|IN|India|🇮🇳",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/India.png"
  },
  "马来西亚": {
    pattern: "(?i)马来西亚|马来|MY|Malaysia|🇲🇾",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Malaysia.png"
  },
  "爱尔兰": {
    pattern: "(?i)爱尔兰|Ireland|IE|ChatGPT|🇮🇪",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Ireland.png"
  },
};

function hasLowCost(config) {
  const lowCostRegex = /0\.[0-5]|低倍率|省流|大流量|实验性/i;
  return (config.proxies || []).some(proxy => lowCostRegex.test(proxy.name));
}

function parseCountries(config) {
  const proxies = config.proxies || [];
  const ispRegex = /家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地/i;   // 需要排除的关键字

  // 用来累计各国节点数
  const countryCounts = Object.create(null);

  // 构建地区正则表达式，去掉 (?i) 前缀
  const compiledRegex = {};
  for (const [country, meta] of Object.entries(countriesMeta)) {
    compiledRegex[country] = new RegExp(
      meta.pattern.replace(/^\(\?i\)/, ''),
      'i'
    );
  }

  // 逐个节点进行匹配与统计
  for (const proxy of proxies) {
    const name = proxy.name || '';

    // 过滤掉不想统计的 ISP 节点
    if (ispRegex.test(name)) continue;

    // 找到第一个匹配到的地区就计数并终止本轮
    for (const [country, regex] of Object.entries(compiledRegex)) {
      if (regex.test(name)) {
        countryCounts[country] = (countryCounts[country] || 0) + 1;
        break;    // 避免一个节点同时累计到多个地区
      }
    }
  }

  // 将结果对象转成数组形式
  const result = [];
  for (const [country, count] of Object.entries(countryCounts)) {
    result.push({ country, count });
  }

  return result;   // [{ country: 'Japan', count: 12 }, ...]
}


function buildCountryProxyGroups({ countries, landing, loadBalance }) {
  const groups = [];
  const baseExcludeFilter = "低倍率|省流|大流量";
  const landingExcludeFilter = "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地";
  const groupType = loadBalance ? "load-balance" : "url-test";

  for (const country of countries) {
    const meta = countriesMeta[country];
    if (!meta) continue;

    const groupConfig = {
      "name": `${country}${NODE_SUFFIX}`,
      "icon": meta.icon,
      "include-all": true,
      "filter": meta.pattern,
      "exclude-filter": landing ? `${landingExcludeFilter}|${baseExcludeFilter}` : baseExcludeFilter,
      "type": groupType
    };

    if (!loadBalance) {
      Object.assign(groupConfig, {
        "url": "https://cp.cloudflare.com/generate_204",
        "interval": 60,
        "tolerance": 20,
        "lazy": false
      });
    }

    groups.push(groupConfig);
  }

  return groups;
}

function buildProxyGroups({
  landing,
  countries,
  countryProxyGroups,
  countryGroupNames,
  lowCost,
  defaultProxies,
  defaultProxiesDirect,
  defaultSelector,
  defaultFallback
}) {
  // 查看是否有特定地区的节点
  const hasTW = countries.includes("台湾");
  const hasHK = countries.includes("香港");

  // 排除落地节点、选择节点和故障转移以避免死循环
  const frontProxySelector = landing
    ? defaultSelector.filter(name => name !== PROXY_GROUPS.LANDING && name !== PROXY_GROUPS.FALLBACK)
    : [];

  // 构建各服务的优先级代理列表
  const openaiProxies = buildServiceProxies({
    priorityCountries: SERVICE_PRIORITY.OpenAI,
    countryGroupNames,
    lowCost
  });
  const claudeProxies = buildServiceProxies({
    priorityCountries: SERVICE_PRIORITY.Claude,
    countryGroupNames,
    lowCost
  });
  const geminiProxies = buildServiceProxies({
    priorityCountries: SERVICE_PRIORITY.Gemini,
    countryGroupNames,
    lowCost
  });
  const perplexityProxies = buildServiceProxies({
    priorityCountries: SERVICE_PRIORITY.Perplexity,
    countryGroupNames,
    lowCost
  });
  const googleProxies = buildServiceProxies({
    priorityCountries: SERVICE_PRIORITY.Google,
    countryGroupNames,
    lowCost
  });
  const tiktokProxies = buildServiceProxies({
    priorityCountries: SERVICE_PRIORITY.TikTok,
    countryGroupNames,
    lowCost
  });
  const redditProxies = buildServiceProxies({
    priorityCountries: SERVICE_PRIORITY.Reddit,
    countryGroupNames,
    lowCost
  });
  const javspProxies = buildServiceProxies({
    priorityCountries: SERVICE_PRIORITY.JavSP,
    countryGroupNames,
    lowCost
  });

  return [
    // 基础分组
    {
      "name": PROXY_GROUPS.SELECT,
      "icon": "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png",
      "type": "select",
      "proxies": defaultSelector
    },
    {
      "name": PROXY_GROUPS.MANUAL,
      "icon": "https://gcore.jsdelivr.net/gh/shindgewongxj/WHATSINStash@master/icon/select.png",
      "include-all": true,
      "type": "select"
    },
    (landing) ? {
      "name": "前置代理",
      "icon": "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Area.png",
      "type": "select",
      "include-all": true,
      "exclude-filter": "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地",
      "proxies": frontProxySelector
    } : null,
    (landing) ? {
      "name": PROXY_GROUPS.LANDING,
      "icon": "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Airport.png",
      "type": "select",
      "include-all": true,
      "filter": "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地",
    } : null,
    {
      "name": PROXY_GROUPS.FALLBACK,
      "icon": "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Bypass.png",
      "type": "fallback",
      "url": "https://cp.cloudflare.com/generate_204",
      "proxies": defaultFallback,
      "interval": 180,
      "tolerance": 20,
      "lazy": false
    },

    // AI 服务分组（细分）
    {
      "name": "OpenAI",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/ChatGPT.png",
      "type": "select",
      "proxies": openaiProxies
    },
    {
      "name": "Claude",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Claude.png",
      "type": "select",
      "proxies": claudeProxies
    },
    {
      "name": "Gemini",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/AI.png",
      "type": "select",
      "proxies": geminiProxies
    },
    {
      "name": "Perplexity",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Perplexity.png",
      "type": "select",
      "proxies": perplexityProxies
    },
    {
      "name": "Copilot",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Copilot.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Google",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Google_Search.png",
      "type": "select",
      "proxies": googleProxies
    },

    // 社交媒体分组
    {
      "name": "Telegram",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Telegram.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Discord",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Discord.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Facebook",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Facebook.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Reddit",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Reddit.png",
      "type": "select",
      "proxies": redditProxies
    },

    // 流媒体分组
    {
      "name": "YouTube",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/YouTube.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Netflix",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Netflix.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "DisneyPlus",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Disney+_1.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Hulu",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Hulu.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "HBO",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/HBO_1.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "TikTok",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/TikTok_1.png",
      "type": "select",
      "proxies": tiktokProxies
    },
    {
      "name": "Bilibili",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/bilibili_1.png",
      "type": "select",
      "proxies": (hasTW && hasHK) ? [PROXY_GROUPS.DIRECT, "台湾节点", "香港节点"] : defaultProxiesDirect
    },
    {
      "name": "Spotify",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Spotify.png",
      "type": "select",
      "proxies": defaultProxies
    },

    // 企业服务分组（直连优先）
    {
      "name": "Microsoft",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Microsoft.png",
      "type": "select",
      "proxies": defaultProxiesDirect
    },
    {
      "name": "OneDrive",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/OneDrive.png",
      "type": "select",
      "proxies": defaultProxiesDirect
    },
    {
      "name": "OutLook",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Mail.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Apple",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Apple_1.png",
      "type": "select",
      "proxies": defaultProxiesDirect
    },
    {
      "name": "Amazon",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Amazon_1.png",
      "type": "select",
      "proxies": defaultProxiesDirect
    },
    {
      "name": "Speedtest",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Speedtest.png",
      "type": "select",
      "proxies": defaultProxiesDirect
    },

    // 游戏/下载分组
    {
      "name": "Steam",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Steam.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Ubisoft",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Ubisoft.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "Netch",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Game.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "PikPak",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Pikpak.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "PayPal",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/PayPal.png",
      "type": "select",
      "proxies": defaultProxies
    },
    {
      "name": "JavSP",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/JavSP.png",
      "type": "select",
      "proxies": javspProxies
    },
    {
      "name": "IDM",
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Download.png",
      "type": "select",
      "proxies": [PROXY_GROUPS.DIRECT, PROXY_GROUPS.SELECT]
    },

    // 系统分组
    {
      "name": PROXY_GROUPS.DIRECT,
      "icon": "https://cdn.jsdelivr.net/gh/zuluion/Qure@master/IconSet/Color/Direct.png",
      "type": "select",
      "proxies": ["DIRECT", PROXY_GROUPS.SELECT]
    },
    {
      "name": "广告拦截",
      "icon": "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/AdBlack.png",
      "type": "select",
      "proxies": ["REJECT", "REJECT-DROP", PROXY_GROUPS.DIRECT]
    },
    (lowCost) ? {
      "name": PROXY_GROUPS.LOW_COST,
      "icon": "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Lab.png",
      "type": "url-test",
      "url": "https://cp.cloudflare.com/generate_204",
      "include-all": true,
      "filter": "(?i)0\\.[0-5]|低倍率|省流|大流量|实验性"
    } : null,
    ...countryProxyGroups
  ].filter(Boolean); // 过滤掉 null 值
}

function main(config) {
  const resultConfig = { proxies: config.proxies };
  // 解析地区与低倍率信息
  const countryInfo = parseCountries(resultConfig); // [{ country, count }]
  const lowCost = hasLowCost(resultConfig);
  const countryGroupNames = getCountryGroupNames(countryInfo, countryThreshold);
  const countries = stripNodeSuffix(countryGroupNames);

  // 构建基础数组
  const {
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback
  } = buildBaseLists({ landing, lowCost, countryGroupNames });

  // 为地区构建对应的 url-test / load-balance 组
  const countryProxyGroups = buildCountryProxyGroups({ countries, landing, loadBalance });

  // 生成代理组
  const proxyGroups = buildProxyGroups({
    landing,
    countries,
    countryProxyGroups,
    countryGroupNames,
    lowCost,
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback
  });

  // 完整书写 Global 代理组以确保兼容性
  const globalProxies = proxyGroups.map(item => item.name);
  proxyGroups.push(
    {
      "name": "GLOBAL",
      "icon": "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Global.png",
      "include-all": true,
      "type": "select",
      "proxies": globalProxies
    }
  );

  const finalRules = buildRules({ quicEnabled });

  if (fullConfig) Object.assign(resultConfig, {
    "mixed-port": 7890,
    "redir-port": 7892,
    "tproxy-port": 7893,
    "routing-mark": 7894,
    "allow-lan": true,
    "ipv6": ipv6Enabled,
    "mode": "rule",
    "unified-delay": true,
    "tcp-concurrent": true,
    "find-process-mode": "off",
    "log-level": "info",
    "geodata-loader": "standard",
    "external-controller": ":9999",
    "disable-keep-alive": !keepAliveEnabled,
    "profile": {
      "store-selected": true,
    }
  });

  Object.assign(resultConfig, {
    "proxy-groups": proxyGroups,
    "rule-providers": ruleProviders,
    "rules": finalRules,
    "sniffer": snifferConfig,
    "dns": fakeIPEnabled ? dnsConfigFakeIp : dnsConfig,
    "geodata-mode": true,
    "geox-url": geoxURL,
  });

  return resultConfig;
}