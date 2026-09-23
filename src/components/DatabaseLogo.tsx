import { useApp } from "../store/appStore";
import { databaseBrand, connectionAccent, brandInitials } from "../lib/databaseIdentity";

/**
 * 连接标识 —— **自绘的字母徽标,不用厂商 logo**。
 *
 * 原来这里内联了 15 个数据库厂商的 logo(取自 DBeaver 仓库)。
 * DBeaver 的**代码**是 Apache-2.0,但那些图不是它的:
 * MySQL 的海豚和 Oracle 的红字是 Oracle 的注册商标,OceanBase 是蚂蚁的,
 * GaussDB/openGauss 是华为的。别人转发不等于把许可传下来。
 * 而 MIT 写着「可以使用、复制、修改、再授权、**出售**」——
 * 我们无权替 Oracle 替华为授予这些。
 *
 * 这个组件真正的功能是**一眼分辨不同连接**,字母 + 配色同样能做到,
 * 而且连接自定义颜色时比固定 logo 更好认。
 */
export default function DatabaseLogo({ connId }: { connId: string }) {
  const config = useApp((s) => s.connections.find((c) => c.id === connId));
  const version = useApp((s) => s.meta[connId]?.serverVersion);
  if (!config) return null;
  const brand = databaseBrand(config, version);
  const accent = connectionAccent(config);
  return (
    <span
      className="database-logo database-badge"
      role="img"
      aria-label={brand}
      title={config.brand || brand}
      style={{ backgroundColor: accent }}
    >
      {brandInitials(brand)}
    </span>
  );
}
