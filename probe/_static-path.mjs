import path from 'node:path';

// 两个服务器共用路径边界：坏编码 / NUL 返回 400；目录关系按路径段判断。
// 解码后把反斜线也当分隔符，避免同一 URL 在 Windows 越界、在 POSIX 却被当普通文件名。
export function resolveStaticPath(root, target) {
  let pathname;
  try {
    if (typeof target !== 'string' || !target.startsWith('/')) return { status: 400 };
    pathname = decodeURIComponent(target.split('?')[0]);
  } catch {
    return { status: 400 };
  }
  if (pathname.includes(String.fromCharCode(0))) return { status: 400 };
  pathname = pathname.replaceAll(String.fromCharCode(92), '/');
  if (pathname === '/') pathname = '/index.html';
  const rootAbs = path.resolve(root);
  const file = path.resolve(rootAbs, '.' + pathname);
  const relative = path.relative(rootAbs, file);
  // startsWith(root) 会放过 root-extra 兄弟目录；relative 同时处理相对 root 与尾斜杠。
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    return { status: 403 };
  return { status: 200, pathname, file };
}
