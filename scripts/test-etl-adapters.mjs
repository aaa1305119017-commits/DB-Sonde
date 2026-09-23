/* ETL 适配器 —— Kettle / Sqoop / DataX 共用一套契约:把配置文本解析成
 * 「这个作业读了什么、写了什么」。解析错的后果不是报错,是**血缘图上多一条
 * 或少一条边**,而图上看不出哪条是假的。所以这儿测得细。
 *
 * 三条贯穿始终的原则:
 *   1. 方向不能反 —— import 是库→Hadoop,export 是 Hadoop→库,反了整张图的箭头都错;
 *   2. 认不出来的宁可不算 —— 造一条不存在的边,比少一条更糟;
 *   3. 凭据一个字都不能进作业 —— 它会顺着血缘、导出的文档一路流出去。
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-etl-'));
let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`); };

try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `
      export { parseXml, child, children, childText, findAll, decodeEntities } from './src/features/etl/adapters/xml';
      export { parseJdbc, redactJdbc, nameJob } from './src/features/etl/adapters/shared';
      export { kettleAdapter } from './src/features/etl/adapters/kettle';
      export { sqoopAdapter, tokenize } from './src/features/etl/adapters/sqoop';
      export { dataxAdapter } from './src/features/etl/adapters/datax';
      export { etlAdapters } from './src/features/etl/adapters';`,
      resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  const m = createRequire(import.meta.url)(outfile);

  // ── XML 读取器 ──────────────────────────────────────────────────────────
  {
    const { parseXml, child, childText, findAll, decodeEntities } = m;
    const doc = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE transformation>
      <!-- 注释里有 <step> 也不能当真 -->
      <transformation>
        <info><name>日汇总</name></info>
        <step>
          <name>表输入</name>
          <type>TableInput</type>
          <sql><![CDATA[SELECT a, b FROM t WHERE x < 3 AND note = '&amp; &lt;tag&gt;']]></sql>
        </step>
        <step attr="a &gt; b" flag="x"><name>带属性</name><empty/></step>
        <note>&amp;&lt;&gt;&#65;&#x42;</note>
      </transformation>`)[0];

    assert.equal(doc.tag, 'transformation');
    assert.equal(childText(child(doc, 'info'), 'name'), '日汇总');
    assert.equal(findAll(doc, 'step').length, 2, '注释里的 <step> 不算');
    /* CDATA 的意思就是「里面原样保留」。放个 &amp; 和 &lt;tag&gt; 在里面:
       要是按普通文本去解实体,这段 SQL 就被悄悄改写了,跑出来跟用户写的不是一回事。
       (第一版的用例里没有实体,把解码逻辑打开也照样通过 —— 等于没测。) */
    assert.equal(childText(findAll(doc, 'step')[0], 'sql'),
      "SELECT a, b FROM t WHERE x < 3 AND note = '&amp; &lt;tag&gt;'",
      'CDATA 里的内容要一个字不动 —— 解实体会把 SQL 改写');
    assert.equal(findAll(doc, 'step')[1].attrs.attr, 'a > b', '属性里的实体要解码');
    assert.equal(childText(doc, 'note'), '&<>AB', '实体和数字引用都要认');
    assert.equal(decodeEntities('&unknown; &amp;'), '&unknown; &', '认不出的实体原样留着');
    ok('XML:CDATA / 实体 / 注释 / 属性 / DOCTYPE');

    // 多个文件首尾相接
    const two = parseXml('<transformation><info><name>甲</name></info></transformation><job><name>乙</name></job>');
    assert.deepEqual(two.map((d) => d.tag), ['transformation', 'job'], '粘贴多个文件要都读出来');
    // 结构坏了不能死循环、也不能瞎猜
    assert.doesNotThrow(() => parseXml('<a><b></a><c'), '标签没闭合也要能收场');
    assert.equal(parseXml('随便一段不是 XML 的文字').length, 0, '不是 XML 就是空');
    ok('XML:多文档 / 结构损坏时不瞎猜');
  }

  // ── jdbcUrl:各家写法 + 凭据脱敏 ──────────────────────────────────────────
  {
    const { parseJdbc, redactJdbc } = m;
    assert.deepEqual(parseJdbc('jdbc:mysql://192.0.2.2:3306/shop_ads?useSSL=false'), { host: '192.0.2.2:3306', database: 'shop_ads' });
    assert.deepEqual(parseJdbc('jdbc:postgresql://pg:5432/warehouse'), { host: 'pg:5432', database: 'warehouse' });
    assert.deepEqual(parseJdbc('jdbc:oracle:thin:@//ora:1521/ORCLPDB'), { host: 'ora:1521', database: 'ORCLPDB' });
    assert.deepEqual(parseJdbc('jdbc:oracle:thin:@ora:1521:sid1'), { host: 'ora:1521', database: 'sid1' });
    assert.deepEqual(parseJdbc('jdbc:sqlserver://mssql:1433;databaseName=dw'), { host: 'mssql:1433', database: 'dw' },
      'SQL Server 把库名写在分号参数里,不在路径上');
    assert.deepEqual(parseJdbc('jdbc:hive2://hive:10000/ods'), { host: 'hive:10000', database: 'ods' });
    assert.equal(parseJdbc('jdbc:mysql://${DB_HOST}:3306/db').host, undefined, '${...} 是占位符,不是主机名');
    assert.deepEqual(parseJdbc('不是 url'), {});
    ok('jdbcUrl:六种引擎的写法都认,占位符不当真');

    /* detail 会显示在血缘图的悬停提示上,而 jdbcUrl 里是可以带口令的。 */
    assert.equal(redactJdbc('jdbc:mysql://h/db?user=root&password=Sonde123'), 'jdbc:mysql://h/db?user=***&password=***');
    assert.equal(redactJdbc('jdbc:postgresql://root:Sonde123@pg/db'), 'jdbc:postgresql://pg/db', 'URL 里的 user:pw@ 也要抹');
    assert.equal(redactJdbc('jdbc:mysql://h/db?useSSL=false'), 'jdbc:mysql://h/db?useSSL=false', '别的参数不动');
    ok('jdbcUrl:口令抹掉,host 和库名留着');

    /* 口令绕过脱敏的两条路,都真实存在过:
     *   1. parseJdbc 不剥凭据,`//user:pw@host` 整段被当成 host 存进 localStorage
     *      —— detail 那头抹得再干净也没用,host 字段把口令带出去了。
     *   2. Oracle thin 的 `user/pw@host` 写法两个函数都不认。
     * 所以现在只有 stripCredentials 一个入口,parseJdbc 和 redactJdbc 都先过它。 */
    assert.deepEqual(parseJdbc('jdbc:postgresql://root:Sonde123@pg/db'), { host: 'pg', database: 'db' },
      'host 里不许夹带凭据 —— Endpoint.host 的注释写着 never credentials');
    assert.deepEqual(parseJdbc('jdbc:mysql://root@h:3306/db'), { host: 'h:3306', database: 'db' },
      '只有用户名没口令也一样要剥');
    assert.equal(redactJdbc('jdbc:oracle:thin:scott/tiger@//ora:1521/ORCLPDB'), 'jdbc:oracle:thin:@//ora:1521/ORCLPDB',
      'Oracle thin 的 user/pw@ 写法');
    assert.equal(redactJdbc('jdbc:oracle:thin:scott/tiger@ora:1521:sid1'), 'jdbc:oracle:thin:@ora:1521:sid1',
      'Oracle 的 host:port:sid 写法');
    assert.deepEqual(parseJdbc('jdbc:oracle:thin:scott/tiger@//ora:1521/ORCLPDB'), { host: 'ora:1521', database: 'ORCLPDB' },
      '剥完凭据还得解析得出 host 和 service');
    assert.equal(redactJdbc('jdbc:oracle:thin:@//ora:1521/ORCLPDB'), 'jdbc:oracle:thin:@//ora:1521/ORCLPDB',
      '本来就没凭据的别被改坏(幂等)');
    ok('jdbcUrl:host 字段和 Oracle 写法都不再漏口令');
  }

  // ── 已落盘数据的脱敏迁移 ────────────────────────────────────────────────
  /* 解析那头修好了,只保护**以后**导入的。用户已经存在 localStorage 里的那些
   * 带口令的源不会自己消失,而没人会为了清一个口令重导所有 ETL 源。
   * 所以 etlStore 读盘时要过一遍,并且变了就立刻写回 —— 只在内存里改掉不算数,
   * 盘上那份还在。 */
  {
    const storeFile = join(dir, 'store.cjs');
    await build({
      stdin: { contents: `export { useEtl } from './src/features/etl/etlStore';`,
        resolveDir: resolve('.'), loader: 'ts' },
      bundle: true, format: 'cjs', platform: 'node', outfile: storeFile, logLevel: 'silent',
    });

    const dirty = [{ id: 'src1', name: '老数据', jobs: [{
      sources: [{ kind: 'db', host: 'root:Sonde123@pg', database: 'ods', table: 't',
                  detail: 'jdbc:postgresql://root:Sonde123@pg/ods' }],
      targets: [{ kind: 'db', host: 'ora:1521', database: 'DW', table: 'u',
                  detail: 'jdbc:oracle:thin:scott/tiger@//ora:1521/DW' }],
    }] }];

    const writes = [];
    globalThis.localStorage = {
      getItem: (k) => (k === 'sonde.etlSources.v1' ? JSON.stringify(dirty) : null),
      setItem: (k, v) => writes.push([k, v]),
      removeItem: () => {},
    };
    const { useEtl } = createRequire(import.meta.url)(storeFile);
    const job = useEtl.getState().sources[0].jobs[0];

    assert.equal(job.sources[0].host, 'pg', '存着的 host 里的凭据要被抹掉');
    assert.equal(job.sources[0].detail, 'jdbc:postgresql://pg/ods');
    assert.equal(job.targets[0].detail, 'jdbc:oracle:thin:@//ora:1521/DW', 'Oracle 写法同样要迁移');
    assert.equal(job.sources[0].table, 't', '除凭据外的字段一个都不能动');
    assert.equal(job.targets[0].host, 'ora:1521', '本来就干净的 host 保持原样');

    const written = writes.find(([k]) => k === 'sonde.etlSources.v1');
    assert(written, '改完必须写回盘 —— 只在内存里干净不算数');
    assert(!written[1].includes('Sonde123') && !written[1].includes('tiger'),
      '写回盘的那份里不许再有口令');
    ok('ETL 存储:已落盘的凭据会被迁移掉,并且写回磁盘');
  }

  // ── Kettle:.ktr 转换 ────────────────────────────────────────────────────
  {
    const ktr = `<?xml version="1.0"?>
<transformation>
  <info><name>加载网点日汇总</name></info>
  <connection>
    <name>prod</name><type>MYSQL</type>
    <server>192.0.2.2</server><port>3306</port><database>shop_dws</database>
  </connection>
  <step><name>读明细</name><type>TableInput</type><connection>prod</connection>
    <sql><![CDATA[SELECT store_id, gmv FROM dws_outlet_day WHERE dt = '\${d}']]></sql></step>
  <step><name>字段选择</name><type>SelectValues</type></step>
  <step><name>写汇总</name><type>TableOutput</type><connection>prod</connection>
    <schema>shop_ads</schema><table>ads_outlet_daily</table></step>
  <order>
    <hop><from>读明细</from><to>字段选择</to><enabled>Y</enabled></hop>
    <hop><from>字段选择</from><to>写汇总</to><enabled>Y</enabled></hop>
  </order>
</transformation>`;
    const [job] = m.kettleAdapter.parse(ktr);
    assert.equal(job.kind, 'kettle');
    assert.equal(job.name, '加载网点日汇总', '用文件里的转换名');
    assert.equal(job.sources.length, 1);
    assert.equal(job.sources[0].host, '192.0.2.2:3306', '连接定义里的 server+port 要接上');
    assert.equal(job.sources[0].database, 'shop_dws');
    assert.match(job.sources[0].querySql, /FROM dws_outlet_day/, 'CDATA 里的 SQL 要完整带出来');
    assert.equal(job.targets.length, 1);
    assert.equal(job.targets[0].table, 'ads_outlet_daily');
    assert.equal(job.targets[0].database, 'shop_ads', '<schema> 比连接上配的库更贴近这一步写哪儿');
    assert.equal(job.flows, undefined, '只有一条流时不重复存 flows');
    ok('Kettle .ktr:连接 / CDATA 里的 SQL / schema 优先');

    // 认不出的步骤类型不能变成端点
    const noisy = ktr.replace('<step><name>字段选择</name><type>SelectValues</type></step>',
      '<step><name>怪步骤</name><type>SomeFutureStep</type><connection>prod</connection><table>不该出现</table></step>');
    const [j2] = m.kettleAdapter.parse(noisy);
    const allTables = [...j2.sources, ...j2.targets].map((e) => e.table);
    assert(!allTables.includes('不该出现'), '没见过的步骤类型不能当端点 —— 会凭空多一条血缘');
    assert.match(j2.note, /还没认到/, '但要告诉用户漏了什么,别闷着');
    ok('Kettle:没见过的步骤类型不当端点,并如实说明');
  }

  // ── Kettle:两条互不相干的流,不能连成网 ──────────────────────────────────
  {
    const ktr = `<transformation><info><name>两条流</name></info>
  <connection><name>c</name><type>MYSQL</type><server>h</server><port>3306</port><database>db</database></connection>
  <step><name>读A</name><type>TableInput</type><connection>c</connection><sql>SELECT 1 FROM a</sql></step>
  <step><name>写A</name><type>TableOutput</type><connection>c</connection><table>a_out</table></step>
  <step><name>读B</name><type>TableInput</type><connection>c</connection><sql>SELECT 1 FROM b</sql></step>
  <step><name>写B</name><type>TableOutput</type><connection>c</connection><table>b_out</table></step>
  <order>
    <hop><from>读A</from><to>写A</to><enabled>Y</enabled></hop>
    <hop><from>读B</from><to>写B</to><enabled>Y</enabled></hop>
  </order></transformation>`;
    const [job] = m.kettleAdapter.parse(ktr);
    assert(job.flows, '两条独立的流必须拆成 flows —— 合成一条的话 2×2 会连出四条边,其中两条不存在');
    assert.equal(job.flows.length, 2, '按 hop 分成两条流');
    const pairs = job.flows.map((f) => [f.sources[0].querySql.match(/FROM (\w+)/)[1], f.targets[0].table]).sort();
    assert.deepEqual(pairs, [['a', 'a_out'], ['b', 'b_out']], 'a 只连 a_out,b 只连 b_out');
    ok('Kettle:按步骤连线分流,不把无关的输入输出连成网');

    // 停用的连线不算
    const disabled = ktr.replace('<hop><from>读B</from><to>写B</to><enabled>Y</enabled></hop>',
      '<hop><from>读B</from><to>写B</to><enabled>N</enabled></hop>');
    const [j2] = m.kettleAdapter.parse(disabled);
    assert.equal(j2.flows.length, 3, '停用的连线不传数据,读B 和 写B 就各自独立了');
    ok('Kettle:停用的连线不算数');
  }

  // ── Kettle:.kjb 作业 ────────────────────────────────────────────────────
  {
    const kjb = `<job><name>每日调度</name>
  <connection><name>c</name><type>MYSQL</type><server>h</server><port>3306</port><database>db</database></connection>
  <entries>
    <entry><name>清表</name><type>SQL</type><connection>c</connection>
      <sql><![CDATA[TRUNCATE TABLE ads_x]]></sql></entry>
    <entry><name>跑转换</name><type>TRANS</type><filename>\${Internal.Job.Filename.Directory}/load.ktr</filename></entry>
    <entry><name>跑子作业</name><type>JOB</type><filename>sub.kjb</filename></entry>
  </entries></job>`;
    const [job] = m.kettleAdapter.parse(kjb);
    assert.equal(job.name, '每日调度');
    assert.deepEqual(job.references, ['${Internal.Job.Filename.Directory}/load.ktr', 'sub.kjb'],
      '.kjb 的活是调别的文件,这些引用要留着');
    assert.match(job.sources[0].querySql, /TRUNCATE TABLE ads_x/, 'SQL 作业项的语句要带出来,由血缘层去解');
    ok('Kettle .kjb:调用关系 + SQL 作业项');

    assert.throws(() => m.kettleAdapter.parse('<foo/>'), /transformation.*job|job.*transformation/,
      '不是 .ktr/.kjb 要报清楚,不是静默返回空');
    ok('Kettle:贴错东西时报得清楚');
  }

  // ── Sqoop:命令行切词 ────────────────────────────────────────────────────
  {
    const { tokenize } = m;
    assert.deepEqual(tokenize('sqoop import \\\n  --table t'), ['sqoop', 'import', '--table', 't'], '反斜杠续行');
    assert.deepEqual(tokenize(`--query "SELECT a FROM t WHERE \\$CONDITIONS"`),
      ['--query', 'SELECT a FROM t WHERE $CONDITIONS'], '引号里的空格不切,\\$ 要还原成 $');
    assert.deepEqual(tokenize('# 注释\nsqoop import'), ['sqoop', 'import'], '整行注释跳过');
    ok('Sqoop:续行 / 引号 / 注释');
  }

  // ── Sqoop:方向和端点 ────────────────────────────────────────────────────
  {
    const script = `#!/bin/bash
# 每天把网点表拉进 Hive
sqoop import \\
  --connect jdbc:mysql://192.0.2.2:3306/shop_ods \\
  --username etl --password Sonde123 \\
  --table t_store \\
  --hive-import --hive-database ods --hive-table t_store \\
  --target-dir /user/hive/warehouse/ods.db/t_store

sqoop export --connect jdbc:mysql://192.0.2.2:3306/shop_rpt \\
  --table rpt_daily --export-dir /user/hive/warehouse/ads.db/daily -P
`;
    const jobs = m.sqoopAdapter.parse(script);
    assert.equal(jobs.length, 2, '一段脚本里的多条命令都要解析出来');

    const [imp, exp] = jobs;
    // import:库 → Hadoop
    assert.equal(imp.sources.length, 1);
    assert.equal(imp.sources[0].table, 't_store');
    assert.equal(imp.sources[0].host, '192.0.2.2:3306');
    assert.equal(imp.sources[0].database, 'shop_ods');
    const impTargets = imp.targets.map((e) => e.table ?? e.path).sort();
    assert.deepEqual(impTargets, ['/user/hive/warehouse/ods.db/t_store', 't_store'], 'Hive 表和 HDFS 目录都是目标');
    assert.equal(imp.targets.find((e) => e.system === 'hive').database, 'ods');

    // export:方向反过来
    assert.equal(exp.sources[0].path, '/user/hive/warehouse/ads.db/daily', 'export 的源是 HDFS');
    assert.equal(exp.targets[0].table, 'rpt_daily', 'export 的目标是库表');
    assert.equal(exp.targets[0].database, 'shop_rpt');
    ok('Sqoop:import 是库→Hadoop,export 是 Hadoop→库,方向不能反');

    /* 凭据一个字都不能进作业 —— 它会顺着血缘图和导出的文档流出去。
       真正挡住它的是「只读白名单里的那几个参数」(--connect / --table / --query …),
       SECRET_FLAGS 是第二道:防的是 `--password xxx` 被错当成别的参数的值吞进去。
       所以把 SECRET_FLAGS 去掉这条断言也照样过 —— 那不是测试没用,是系统有两道防线。
       能抓住真实回归的是下面那条:谁要是图省事把原始命令塞进 note/detail,立刻变红。 */
    const dumped = JSON.stringify(jobs);
    for (const secret of ['Sonde123', 'etl', 'password', 'username']) {
      assert(!dumped.includes(secret), `作业里不该出现「${secret}」—— 凭据会顺着血缘一路流出去`);
    }
    // 等号写法也不能漏
    const [eq] = m.sqoopAdapter.parse('sqoop import --connect=jdbc:mysql://h/db --table=t --password=Sonde123 --target-dir=/p');
    assert(!JSON.stringify(eq).includes('Sonde123'), '--password=xxx 这种等号写法同样不能带进来');
    assert.equal(eq.sources[0].table, 't', '但等号写法的正经参数要认');
    ok('Sqoop:用户名口令一个字都没带进来(两种写法)');
  }

  // ── Sqoop:--query / db.table / 说不清时如实说 ────────────────────────────
  {
    const [q] = m.sqoopAdapter.parse(
      `sqoop import --connect jdbc:mysql://h:3306/db --query "SELECT a FROM x JOIN y ON 1=1 WHERE \\$CONDITIONS" --target-dir /p`);
    assert.equal(q.sources[0].table, undefined);
    assert.match(q.sources[0].querySql, /JOIN y/, '--query 里才是真读了哪几张表,交给血缘层去解');

    const [h] = m.sqoopAdapter.parse('sqoop import --connect jdbc:mysql://h/db --table t --hcatalog-table ods.t2');
    assert.equal(h.targets[0].database, 'ods', 'db.table 这种写法要拆开');
    assert.equal(h.targets[0].table, 't2');

    const [all] = m.sqoopAdapter.parse('sqoop import-all-tables --connect jdbc:mysql://h/db --warehouse-dir /w');
    assert.match(all.note, /整库导入/, '整库导入说不出具体表,要如实讲');

    const [opt] = m.sqoopAdapter.parse('sqoop import --connect jdbc:mysql://h/db --table t --target-dir /p --options-file /etc/o.txt');
    assert.match(opt.note, /options-file/, '参数在外部文件里没读到,也要讲');

    assert.throws(() => m.sqoopAdapter.parse('echo hello'), /没找到 sqoop/);
    assert.throws(() => m.sqoopAdapter.parse('sqoop version'), /import.*export/);
    ok('Sqoop:--query / 限定表名 / 说不清时如实说明');
  }

  // ── 注册表:两个槽位真的填上了 ──────────────────────────────────────────
  {
    for (const kind of ['kettle', 'sqoop']) {
      const a = m.etlAdapters[kind];
      assert.equal(a.available, true, `${kind} 应该已经可用,不再是预留槽`);
      assert(a.inputHint.length > 0, `${kind} 要告诉用户贴什么`);
      assert.equal(a.kind, kind);
    }
    ok('注册表:kettle / sqoop 已接入');
  }

  console.log(`\nETL 适配器:${passed} 项通过`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
