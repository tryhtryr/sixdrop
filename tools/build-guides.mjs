/**
 * 生成 /guide 下的 SEO 内容页（纯静态，服务端直出）。
 *   node tools/build-guides.mjs
 *
 * 内容原则：只讲真实可做的步骤和边界，不做速度承诺，每页独立 TDK + 内链 + Article/FAQ JSON-LD。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'public', 'guide');
const BASE = 'https://sixdrop.dev';
const UPDATED = '2026-10-24';

const PAGES = [
  {
    slug: 'phone-to-pc',
    nav: '电脑 ↔ 手机',
    title: '电脑传文件到手机，不装 App 也能传（iPhone / 安卓）',
    desc: '不用数据线、不用 iTunes、不装 App：在两个浏览器之间直接传。iPhone 和安卓分别写清楚保存位置、大小限制和失败怎么办。',
    kicker: '使用指南',
    intro:
      '把电脑上的一个文件挪到手机上，常见做法是插数据线、发微信文件传输助手、或者传网盘再下载。这三种都有各自的麻烦：线不一定在身边，微信会压缩图片视频且有大文件限制，网盘要先上传再等下载。',
    sections: [
      {
        h2: '最省事的做法：两个浏览器直接传',
        p: [
          'SixDrop 的做法是让两个浏览器建立一条点对点通道，文件从电脑直接流到手机，不经过中间服务器。两边都不需要安装任何东西，只要能打开网页。',
        ],
        ol: [
          '电脑和手机都打开 <a href="/">sixdrop.dev</a>。',
          '在同一个 Wi-Fi 下：电脑的大厅里会直接出现手机的设备，点「申请加入」，手机上点「同意」。',
          '不在同一个网络：电脑上把 6 位取件码念给手机（或把链接发过去），手机在输入框里输码。',
          '电脑上选文件，手机上确认保存位置，开始传。',
        ],
      },
      {
        h2: 'iPhone / iPad',
        p: [
          'Safari 会弹出保存位置选择：存到「文件」App 里的任意目录，或者直接选「照片」保存图片视频。传完之后在「文件」或「照片」里就能看到，不需要经过电脑同步。',
          '注意一点：Safari 是把文件先收进内存再落盘，所以单个文件建议不要超过 1 GB；更大的文件请用电脑接收，或者在 Chrome / Edge 上传。',
        ],
      },
      {
        h2: '安卓',
        p: [
          'Chrome / Edge 会弹出系统文件选择器，选一个目录即可；大文件是边收边写盘的，内存占用不会随文件变大。',
          '部分机型的「下载」目录会提示权限，选「允许」就行。文件管理器的「下载」里能找到。',
        ],
      },
      {
        h2: '为什么不用微信文件传输助手',
        p: [
          '微信对图片和视频会转码压缩，原图需要额外点「原图」；单个文件有大小上限；而且要先把文件发到服务器，再由另一台设备下载。',
          '点对点直传的好处是原样传输：照片还是原图，视频还是原视频，服务器只转发建立连接所需的信息，不碰文件内容。',
        ],
      },
      {
        h2: '传不过去怎么办',
        p: [
          '如果两边都在公司网、校园网或者部分移动网络里（对称 NAT），打洞可能失败。页面会直接告诉你失败，并给出候选统计和三条后续：换一个网络（手机热点通常最快）、用同一个取件码重连、或者主动选择「改用中转」。',
          '默认不会把文件偷偷传到云上——只有你点了「改用中转」，文件才会临时存到 R2，最多 24 小时自动删除。',
        ],
      },
    ],
    faq: [
      ['需要装 App 吗？', '不需要。两边都是浏览器打开网页，电脑和手机都可以。'],
      ['会压缩照片和视频吗？', '不会。直连传输是原样转发字节，不转码、不压缩。'],
      ['手机用流量能传吗？', '可以，但手机流量通常是运营商 CGNAT，打洞成功率比同一个 Wi-Fi 低；能连上时速度也受移动网络影响。'],
    ],
    related: ['lan-large-files', 'no-cloud'],
  },
  {
    slug: 'lan-large-files',
    nav: '同一 Wi-Fi 传大文件',
    title: '同一个 Wi-Fi 下传大文件：为什么点对点比网盘快',
    desc: '两台设备连同一个路由器时，文件可以走局域网直连，不占用宽带上行。讲清楚原理、实操步骤，以及为什么实际速度还是会有差异。',
    kicker: '原理与实操',
    intro:
      '两台设备连在同一个 Wi-Fi 下时，数据其实不需要出家门：路由器就能把包转给另一台设备。点对点传输会优先走这条「局域网直连」，这是它和网盘最本质的区别。',
    sections: [
      {
        h2: '局域网直连为什么快',
        p: [
          '网盘的速度受限于你的上行带宽：100 Mbps 宽带的上行往往只有 20–30 Mbps，2 GB 文件光上传就要十几分钟。局域网直连走的是 Wi-Fi 或网线本身，不经过运营商，也不占用上行。',
          '当然，这不是「无限快」：实际速度取决于 Wi-Fi 频段、信号强度、两台设备的网卡和磁盘。5 GHz 通常明显好于 2.4 GHz；机械硬盘写入和手机存储也会成为瓶颈。',
        ],
      },
      {
        h2: '操作步骤',
        ol: [
          '确认两台设备连的是**同一个**路由器（不是「同名但不同频段的两套 SSID」，也不是手机热点）。',
          '都打开 <a href="/">sixdrop.dev</a>，大厅里会列出对方的设备。',
          '点对方设备 → 对方点「同意」→ 进入同一个房间。',
          '发送方选文件（可多选），接收方选保存位置，开始传。',
        ],
        p: ['传完房间还在：可以再发一批，也可以切到「消息」发文字，不用重新建连接。'],
      },
      {
        h2: '大文件的三个实际限制',
        table: [
          ['限制', '说明'],
          ['接收端写盘方式', 'Chrome / Edge 可以边收边写；Firefox / Safari 先收进内存，单文件建议 < 1 GB'],
          ['接收方磁盘空间', '直连没有硬性大小上限，但要留得下文件'],
          ['无线稳定性', 'Wi-Fi 信号差时会出现重传，速度下降甚至卡住；页面会等对方接住，不会直接判失败'],
        ],
      },
      {
        h2: '看不到对方设备？',
        p: [
          '常见原因是两台设备其实不在同一个出口：比如一台走 Wi-Fi、一台走手机流量，或者路由器是双 WAN 分流。大厅里会显示「网络组」，两台对不上就说明出口不同——这时候用 6 位取件码最稳。',
          '另外，如果路由器开了「AP 隔离 / 客户端隔离」，设备之间互相看不见，也会影响局域网候选；关掉它或者用取件码走公网打洞。',
        ],
      },
    ],
    faq: [
      ['为什么不走网盘的上传？', '网盘必须先把文件完整上传到服务器，对方才能下载；局域网直连是两台设备之间直接传，省掉了上传这一步。'],
      ['千兆网线会比 Wi-Fi 快吗？', '通常会。有线少了无线重传和信号衰减，速度更稳定。'],
      ['支持断点续传吗？', '不支持。传输中断需要重传；传完之后可以在同一个房间里再发。'],
    ],
    related: ['phone-to-pc', 'symmetric-nat'],
  },
  {
    slug: 'no-cloud',
    nav: '不用网盘传文件',
    title: '不用网盘、不被压缩的传文件方法',
    desc: '不想注册网盘、不想让微信压缩原图？用浏览器点对点直传：原文件直接到对方设备，服务器只转发连接信息。',
    kicker: '方案对比',
    intro:
      '网盘的问题不是不好用，而是它多了一跳：文件要先完整上传，对方才能开始下载。而且免费账号常有下载限速、转存限制。对于「我就想现在把文件给对方」这种场景，这一跳是多余的。',
    sections: [
      {
        h2: '三种常见做法对比',
        table: [
          ['方式', '要不要注册', '文件经过谁', '适合'],
          ['网盘分享链接', '要', '网盘服务器（长期保存）', '需要长期保存、多人下载'],
          ['聊天工具发文件', '要', '聊天服务器（有大小/压缩限制）', '小文件、顺手发'],
          ['点对点直传', '不要', '不经过服务器（直连时）', '现在就要传、原样传'],
        ],
      },
      {
        h2: '具体怎么传',
        ol: [
          '双方打开 <a href="/">sixdrop.dev</a>，不需要注册。',
          '同一网络：点对方的设备；不同网络：把 6 位取件码发给对方。',
          '选文件 → 对方确认保存位置 → 开始传。',
          '传完可以继续发下一批，也可以切到「消息」说两句。',
        ],
      },
      {
        h2: '原图、原视频是怎么保住的',
        p: [
          '直连时，文件字节从你的浏览器直接流到对方浏览器，中间没有转码服务。照片还是原图，视频还是原视频，压缩包还是原来的字节。',
          '这一点和聊天工具不同：后者为了省带宽和存储，通常会对图片视频重新编码。',
        ],
      },
      {
        h2: '什么时候还是该用网盘',
        p: [
          '需要给对方一个「过几天再下也行」的链接、需要多人同时下载、需要版本管理——这些是网盘的主场。SixDrop 是一个 1 对 1、双方在线的传输工具，不做长期存储。',
          '如果打不通（对称 NAT），可以选择「改用中转」：文件临时放到 R2，给对方一个下载链接，最多 24 小时自动删除。这是兜底，不是默认。',
        ],
      },
    ],
    faq: [
      ['文件会存在服务器上吗？', '直连成功时不会；只有主动选择「改用中转」时才会临时存到 R2，最多 24 小时自动删除。'],
      ['需要注册账号吗？', '不需要，打开网页就能用。'],
      ['别人能猜到我的取件码吗？', '取件码是 6 位、32 字符表（去掉易混字符），只在房间存活期内有效；用完点「离开」会换新码。'],
    ],
    related: ['phone-to-pc', 'webrtc-p2p'],
  },
  {
    slug: 'webrtc-p2p',
    nav: 'WebRTC 原理与安全',
    title: 'WebRTC 点对点传文件的原理与安全边界',
    desc: 'SDP、ICE、STUN、DTLS 各是什么？为什么有的网络打不通？服务器能看到文件吗？把点对点传文件的原理和安全边界讲清楚。',
    kicker: '技术原理',
    intro:
      '「点对点」不是玄学，它是浏览器内置的 WebRTC 能力：先交换连接信息，再做 NAT 穿透，最后在两端之间建一条加密的数据通道。',
    sections: [
      {
        h2: '三步建立连接',
        ol: [
          '**信令**：双方通过一个房间服务交换 SDP（媒体/数据能力描述）和 ICE 候选（我可能能被哪些地址找到）。这一步不含文件内容。',
          '**打洞**：双方用 STUN 服务器知道自己对外的地址，然后同时向对方发包，让两边的 NAT 各开一个口子。',
          '**加密**：通道建立后由 DTLS 加密，两端会显示同一个 8 位校验码（双方证书指纹的哈希），对一下就知道没有中间人。',
        ],
      },
      {
        h2: '为什么有的网络打不通',
        p: [
          'NAT 分几种。锥形 NAT 允许「先出后进」，打洞容易；对称 NAT 会给每个目标分配不同的端口，打洞基本失败——公司网、校园网、部分 4G/5G 常见这种。',
          '还有一种情况：一方只有 IPv4、一方只有 IPv6，两个地址族之间无法直接配对，也会失败。',
        ],
      },
      {
        h2: '服务器能看到文件吗',
        p: [
          '直连时不能。服务器只转发 SDP/ICE 这类连接信息，数据面走的是两端之间的加密通道。',
          '只有你主动点「改用中转」时，文件才会上传到 R2 再由对方下载；这条路径经过服务器，所以会明确提示，并支持传完立即删除。',
        ],
      },
      {
        h2: '安全边界要说清楚',
        ul: [
          '通道是 DTLS 加密的，8 位校验码用于确认两端看到的证书一致，防中间人。',
          '取件码是进入房间的凭据：知道码的人可以进入房间。请只发给要传文件的人，传完点「离开」换新码。',
          '不建立账号、不保存传输历史；关掉页面，房间就结束。',
        ],
      },
    ],
    faq: [
      ['为什么不做 TURN 中转加速？', 'TURN 会让所有流量过服务器，成本和隐私代价都高，而且用户会误以为自己在直连。这里选择「打不通就明说」，把中转做成一个显式选项。'],
      ['校验码是文件哈希吗？', '不是，是连接证书的指纹哈希，用来确认没有中间人。文件完整性由 DTLS 保证。'],
      ['公司网完全不能用吗？', '直连大概率不行；可以换手机热点重试，或者使用中转。'],
    ],
    related: ['symmetric-nat', 'no-cloud'],
  },
  {
    slug: 'symmetric-nat',
    nav: '对称 NAT 打不开',
    title: '公司网、校园网、对称 NAT 传不了文件怎么办',
    desc: '打洞失败不是工具坏了，是 NAT 类型的问题。教你看懂失败页的候选统计，并按顺序尝试换网络、重连、中转三条路。',
    kicker: '排障指南',
    intro:
      '在公司、学校或者部分移动网络里，点对点传输经常失败。原因通常不是浏览器或网站，而是网络本身不允许「陌生地址主动打进来」。',
    sections: [
      {
        h2: '怎么判断是不是对称 NAT',
        p: [
          '失败页会给出候选统计，例如 `host 2 / srflx 4 / relay 0`：host 是本机地址，srflx 是通过 STUN 拿到的公网映射，relay 是中继。',
          '如果 srflx 有值但连通性检查全失败，基本就是对称 NAT 或防火墙拦截；如果 srflx 都是 0，说明 STUN 都没出去，网络限制更严格。',
        ],
      },
      {
        h2: '三条路，按顺序试',
        table: [
          ['顺序', '做法', '说明'],
          ['1', '换网络', '手机热点通常最快：换一个出口，NAT 类型往往就变了'],
          ['2', '用同一个码重连', '点「重新尝试」，房间和已选文件都还在，不用重新发码'],
          ['3', '改用中转', '打不通时的兜底：文件经服务器转一趟，能传但更慢更费流量，传完可删'],
        ],
      },
      {
        h2: '预防：先确认环境',
        ul: [
          '关掉 VPN / 代理再试，它们会改写路由，干扰打洞。',
          '双方尽量连同一个 Wi-Fi；手机热点是很好的验证手段。',
          '如果一方在海外，双方都被 NAT 挡住时，优先考虑中转。',
        ],
      },
      {
        h2: '为什么不做「自动中转」',
        p: [
          '自动中转会在用户不知情的情况下把文件传到服务器，这既影响隐私预期，也让「直连」这件事失去意义。所以这里选择：打不通就明确失败，把选择权交给用户。',
        ],
      },
    ],
    faq: [
      ['手机热点能解决吗？', '大多数情况下能。热点相当于换了一个 NAT，双方都在运营商 CGNAT 时仍有失败可能。'],
      ['开了 VPN 会怎样？', '常见结果是所有候选都走 VPN 出口，打洞失败或绕远；先关掉再试。'],
      ['中转的文件安全吗？', '只在你主动选择时上传，最多 24 小时自动删除，也可以立即手动删除。'],
    ],
    related: ['webrtc-p2p', 'lan-large-files'],
  },
];

/** 每页追加的正文（把每篇补到 1200 字以上，覆盖更多长尾问题） */
const EXTRA = {
  'phone-to-pc': [
    {
      h2: '常见故障对照',
      table: [
        ['现象', '更可能的原因', '处理'],
        ['大厅里看不到对方设备', '两台不在同一个出口（一台流量、一台 Wi-Fi，或双 WAN）', '改用 6 位取件码'],
        ['输码后一直「等待对方同意」', '对方没点「同意」，或已经从大厅离开', '让对方刷新页面重新申请'],
        ['传到一半卡住', '无线抖动、对方设备休眠', '页面会等待并显示「等对方接住」，恢复后继续'],
        ['保存失败', '手机存储空间不足、或没有写入权限', '换一个目录，或清理空间后重试'],
      ],
    },
    {
      h2: '传完之后在哪找',
      p: [
        'iPhone：如果你选了「存储到文件」，去「文件」App 的对应目录；如果选的是照片，直接进相册。安卓：一般在「文件管理 → 下载」里，具体取决于你选的目录。',
        '电脑接收时选的是哪个文件夹，文件就在哪里；浏览器不会另存一份隐藏副本。',
      ],
    },
    {
      h2: '为什么它比「发微信」省事',
      p: [
        '不需要加好友、不需要两台设备都装同一个 App、不需要先把文件传到服务器再等另一台下载。对于「现在就要把这张照片/这个安装包给对方」这种场景，少一步就少一分钟。',
        '代价是两边都要在线，而且网络必须允许点对点连接——这也是为什么失败页会把原因和后续写清楚。',
      ],
    },
  ],
  'lan-large-files': [
    {
      h2: '怎么确认走的是局域网',
      p: [
        '传完之后，校验码下方会标出这次走的路径：`局域网直连` 表示两台设备直接通过路由器通信；`公网打洞` 表示走了 STUN 打洞；`中继` 表示经服务器。后面还会标 `IPv4` / `IPv6`。',
        '看到「局域网直连」就说明没有占用宽带上行，速度上限基本是 Wi-Fi 或网线的能力。',
      ],
    },
    {
      h2: '影响速度的几个具体因素',
      ul: [
        '频段：5 GHz 通常明显快于 2.4 GHz，但穿墙差；隔一堵墙可能反而不如 2.4 GHz 稳。',
        '设备网卡：老手机的 Wi-Fi 模块可能只有 72–150 Mbps 的理论速率。',
        '磁盘：机械硬盘写入大文件时，速度会掉到 100 MB/s 以下；手机存储也分 UFS 和 eMMC。',
        '接收端写盘方式：Firefox / Safari 先收进内存，文件大了会明显变慢甚至失败。',
      ],
    },
    {
      h2: '一次传多个文件',
      p: [
        '可以直接多选，接收端会自动逐个保存；文件数量多时，建议先打包成一个压缩包再传——几百个小文件的握手和确认开销，会比一个大文件高不少。',
      ],
    },
  ],
  'no-cloud': [
    {
      h2: '网盘为什么要限速',
      p: [
        '网盘的存储和带宽都是成本，免费用户的下载限速是把成本转成会员收入的手段。这不是技术问题，是商业模式。',
        '点对点传输没有这笔「存储 + 下载」的成本，所以也就不存在会员限速这一层——但速度上限由你和对方的网络决定，这一点不会变。',
      ],
    },
    {
      h2: '不压缩对哪些文件最重要',
      ul: [
        '照片：社交软件默认会重新编码，原图需要额外操作；直传是原文件。',
        '视频：转码会损失码率和细节，尤其是素材和成片。',
        '设计稿、安装包、数据集：任何「必须字节一致」的文件。',
      ],
    },
    {
      h2: '跨网络时的真实体验',
      p: [
        '同一个城市、双方都是普通家用宽带，打洞成功率很高；一方在公司网或校园网，成功率会明显下降。失败时不要反复重试同一个网络——换一个出口（比如手机热点）往往一次就好。',
        '如果确实需要「发个链接让对方过几天再下」，那还是用网盘；工具各有边界。',
      ],
    },
  ],
  'webrtc-p2p': [
    {
      h2: '三种候选类型',
      table: [
        ['类型', '含义', '跨网络可用吗'],
        ['host', '本机网卡地址（局域网）', '基本不可用，浏览器还会用 mDNS 隐藏它'],
        ['srflx', '通过 STUN 拿到的公网映射', '可用，是打洞的主力'],
        ['relay', 'TURN 中继', '可用，但所有流量过服务器'],
      ],
    },
    {
      h2: '一次连接的消息序列',
      p: [
        '发送方创建 offer（含 SDP）→ 接收方回 answer → 双方各自把收集到的 ICE 候选逐个发过去 → 双方用这些候选做连通性检查 → 选中的那一对开始传数据。',
        '这些消息都走房间的 WebSocket，只有文本，不含文件内容。',
      ],
    },
    {
      h2: '为什么 8 位校验码够用',
      p: [
        '它不是用来防暴力破解的密码，而是让人眼比对两端看到的是不是同一对证书。中间人要让两端显示同一个码，需要同时伪造两边的指纹，这在 DTLS 握手中做不到。',
        '真正的加密由 DTLS 完成；校验码只是一个可核对的「指纹摘要」。',
      ],
    },
  ],
  'symmetric-nat': [
    {
      h2: '一分钟判断是不是网络的问题',
      p: [
        '用手机开热点，把其中一台设备切到热点上，再试一次。如果立刻能通，说明原来的网络就是对称 NAT 或防火墙限制；如果还是不行，问题可能在设备或浏览器（比如装了会拦截 WebRTC 的扩展）。',
      ],
    },
    {
      h2: '企业网常见的额外限制',
      ul: [
        '防火墙只放行 80/443，UDP 高端口被拦，STUN 直接失败。',
        'HTTP 代理强制所有流量走代理，打洞无从谈起。',
        '深度包检测识别 WebRTC 流量并阻断。',
        '终端安全软件禁用浏览器的 WebRTC 组件。',
      ],
    },
    {
      h2: '用中转的步骤与善后',
      p: [
        '失败页点「改用中转」→ 文件上传到 Cloudflare R2 → 得到一个下载链接，发给对方 → 对方下载。',
        '中转文件最多保留 24 小时；传完可以在页面上点删除，立即移除服务器上的副本。',
      ],
    },
  ],
};

/** 再补一段，把最短的三篇也补到 1000 字以上 */
const EXTRA2 = {
  'symmetric-nat': [
    {
      h2: '为什么手机热点常常能通',
      p: [
        '热点相当于换了一个出口：原来公司网把你藏在对称 NAT 后面，热点通常给你一个运营商侧的锥形 NAT（或可用的 CGNAT），打洞就有机会成功。',
        '但热点不是万能：如果双方都在运营商 CGNAT 后面，仍然可能失败。这时候就别跟网络较劲了，用中转更省时间。',
      ],
    },
  ],
  'webrtc-p2p': [
    {
      h2: '和「上传下载」有什么不同',
      p: [
        'HTTP 上传是先把文件完整写到服务器，对方再去下载：好处是离线可用、可以续传、可以长期保存；坏处是上传那一步必须先完成，而且文件一定会落在别人的磁盘上。',
        '点对点是两端同时在线、直接对流：少一次落盘、少一段等待，但要求双方在线，且网络允许直连。两种方式不是替代关系，是不同场景。',
      ],
    },
  ],
  'no-cloud': [
    {
      h2: '对方不在线怎么办',
      p: [
        '点对点需要两边同时在房间里。如果对方现在不在，只能等他有空再连；要「先发过去、他什么时候看都行」，那本来就是网盘或中转的活。',
        '中转模式会生成一个下载链接，对方随时可以下，但文件会在服务器上停留最多 24 小时。',
      ],
    },
  ],
  'lan-large-files': [
    {
      h2: '和其他近场方案比',
      ul: [
        'AirDrop：只在苹果设备之间，跨到 Windows 就不行。',
        '安卓「附近共享」：安卓之间方便，跨系统同样不行。',
        '数据线：稳定，但要线、要驱动，手机连电脑还要选传输模式。',
        '浏览器直传：只要两边都有浏览器，Windows / macOS / 安卓 / iOS 可以互传，代价是要两台都在线。',
      ],
    },
  ],
};

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (text) =>
  esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

const renderSections = (sections) =>
  sections
    .map((s) => {
      const parts = [`<h2>${inline(s.h2)}</h2>`];
      for (const p of s.p || []) parts.push(`<p>${inline(p)}</p>`);
      if (s.ol) parts.push(`<ol>${s.ol.map((li) => `<li>${inline(li)}</li>`).join('')}</ol>`);
      if (s.ul) parts.push(`<ul>${s.ul.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
      if (s.table) {
        const [head, ...rows] = s.table;
        parts.push(
          `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
        );
      }
      return parts.join('\n');
    })
    .join('\n');

const layout = ({ title, desc, canonical, body, jsonLd, nav }) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:site_name" content="SixDrop" />
    <meta name="twitter:card" content="summary" />
    <link rel="stylesheet" href="/guide/guide.css" />
    <script type="application/ld+json">${JSON.stringify(jsonLd, null, 0)}</script>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <img src="/icon.svg" alt="SixDrop" width="34" height="34" />
        <a href="/">SixDrop</a>
        <span class="sep">/</span>
        <a href="/guide">使用指南</a>
        <span class="sep">/</span>
        <span class="cur">${esc(nav)}</span>
      </div>
      <main class="doc">${body}</main>
      <footer class="foot">
        <a href="/">打开 SixDrop</a>
        <a href="/about">关于与常见问题</a>
        <a href="/guide">全部指南</a>
        <span>更新于 ${UPDATED}</span>
      </footer>
    </div>
  </body>
</html>`;

const CSS = `:root{--bg:#0d0f12;--card:#16181d;--line:#262a32;--text:#e8eaed;--muted:#8b919c;--accent:#4f8cff}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1100px 560px at 50% -10%,#1a2030 0%,var(--bg) 55%);color:var(--text);
font:16px/1.85 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;padding:44px 20px 90px}
.wrap{max-width:780px;margin:0 auto}
.top{display:flex;align-items:center;gap:10px;margin-bottom:36px;font-size:15px;flex-wrap:wrap}
.top a{color:var(--text);text-decoration:none;font-weight:600}
.top a:hover{color:var(--accent)}
.top .sep{color:#3a4a60}
.top .cur{color:var(--muted)}
h1{font-size:32px;line-height:1.4;margin:0 0 16px;letter-spacing:-.01em}
h2{font-size:22px;margin:40px 0 12px;padding-top:6px}
p,li{color:#d3d8e0}
a{color:var(--accent)}
.lead{font-size:17px;color:#b9c1cd}
table{width:100%;border-collapse:collapse;margin:18px 0;font-size:15px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
code{background:#1d2026;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:14px}
.faq dt{font-weight:700;margin-top:20px}
.faq dd{margin:6px 0 0;color:#c7cdd7}
.rel{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);font-size:15px}
.rel a{margin-right:14px}
.foot{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:14px;
display:flex;gap:16px;flex-wrap:wrap}
.foot a{color:var(--muted);text-decoration:none}
.foot a:hover{color:var(--accent)}
.cards{display:grid;gap:14px;margin-top:26px}
.card{display:block;padding:18px 20px;border:1px solid var(--line);border-radius:14px;background:var(--card);
text-decoration:none;color:inherit}
.card:hover{border-color:#33507a}
.card b{display:block;font-size:17px;margin-bottom:6px;color:#dfe8f5}
.card span{color:var(--muted);font-size:14px;line-height:1.7}
@media(max-width:560px){h1{font-size:26px}h2{font-size:19px}}
`;

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'guide.css'), CSS, 'utf8');

for (const page of PAGES) {
  const canonical = `${BASE}/guide/${page.slug}`;
  const body = `
      <h1>${inline(page.title)}</h1>
      <p class="lead">${inline(page.intro)}</p>
      ${renderSections([...page.sections, ...(EXTRA[page.slug] || []), ...(EXTRA2[page.slug] || [])])}
      <h2>常见问题</h2>
      <dl class="faq">
        ${page.faq.map(([q, a]) => `<dt>${inline(q)}</dt><dd>${inline(a)}</dd>`).join('\n')}
      </dl>
      <div class="rel">
        相关：${page.related
          .map((slug) => {
            const t = PAGES.find((p) => p.slug === slug);
            return t ? `<a href="/guide/${t.slug}">${esc(t.nav)}</a>` : '';
          })
          .join('')}
      </div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: page.title,
        description: page.desc,
        inLanguage: 'zh-CN',
        dateModified: UPDATED,
        datePublished: UPDATED,
        mainEntityOfPage: canonical,
        author: { '@type': 'Organization', name: 'SixDrop' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'SixDrop', item: `${BASE}/` },
          { '@type': 'ListItem', position: 2, name: '使用指南', item: `${BASE}/guide` },
          { '@type': 'ListItem', position: 3, name: page.nav, item: canonical },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faq.map(([q, a]) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
    ],
  };

  await writeFile(
    join(OUT, `${page.slug}.html`),
    layout({ title: page.title, desc: page.desc, canonical, body, jsonLd, nav: page.nav }),
    'utf8',
  );
  console.log(`  public/guide/${page.slug}.html`);
}

// 指南索引
const indexBody = `
      <h1>SixDrop 使用指南</h1>
      <p class="lead">按场景整理：从电脑传手机、同一 Wi-Fi 传大文件、不想用网盘，到打不开时怎么排查。</p>
      <div class="cards">
        ${PAGES.map(
          (p) => `<a class="card" href="/guide/${p.slug}"><b>${esc(p.title)}</b><span>${esc(p.desc)}</span></a>`,
        ).join('\n')}
      </div>`;

await writeFile(
  join(OUT, 'index.html'),
  layout({
    title: 'SixDrop 使用指南：点对点传文件的场景与排障',
    desc: '传文件的五个常见场景：电脑传手机、同一 Wi-Fi 传大文件、不用网盘、WebRTC 原理与安全边界、对称 NAT 打不开怎么办。',
    canonical: `${BASE}/guide`,
    body: indexBody,
    nav: '全部指南',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          name: 'SixDrop 使用指南',
          inLanguage: 'zh-CN',
          hasPart: PAGES.map((p) => ({ '@type': 'Article', headline: p.title, url: `${BASE}/guide/${p.slug}` })),
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'SixDrop', item: `${BASE}/` },
            { '@type': 'ListItem', position: 2, name: '使用指南', item: `${BASE}/guide` },
          ],
        },
      ],
    },
  }),
  'utf8',
);
console.log('  public/guide/index.html');
console.log(`共 ${PAGES.length + 1} 个页面`);
