# sitemap-radar

监控竞品站 sitemap 的新增 URL。竞品新增页面 = 它们刚验证过的新词,
是零成本的选词领先指标(哥飞打法里"竞品监控"环节的自动化)。

## 本地运行

```bash
cd ~/seo-radar
python3 radar.py            # 首次运行建基线,之后每次报新增
python3 radar.py --report   # 汇总最近 7 天所有新增
```

- 新增 URL 打印到终端,同时追加写入 `reports/YYYY-MM-DD.md`
- 每个站的已知 URL 和首见时间存在 `state/*.json`
- 监控哪些站改 `sites.txt`,一行一个 `名称=sitemap地址`

## 部署到服务器(每天自动跑)

```bash
# 1. 整个目录拷到服务器
scp -r ~/seo-radar user@your-server:~/

# 2. 服务器上加 crontab(每天早 8 点跑一次)
crontab -e
# 加入:
0 8 * * * cd ~/seo-radar && python3 radar.py >> radar.log 2>&1
```

只依赖 Python 3.9+ 标准库,无需 pip install。

## 使用建议

- 首次运行只建基线不报新增,第二天起才有 diff 信号
- 看到某站短期集中新增一批同模式 URL(如 `/tools/xxx-generator`),
  就是它在批量铺一个新词方向——值得立刻研究这批词
- toolify 这类目录站量大,信号是"新收录的工具名";嫌吵可以注释掉
- 发现新的快站(比如从调研报告的竞品清单里),随时加进 sites.txt
