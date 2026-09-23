"""Read-only file inventory. Never sources shell scripts or imports user code.
Input: a JSON object with root. Output: sanitized DataX, SQL and file references.
The same implementation runs locally or over SSH; it needs only Python stdlib.
"""
import ast
import json
import os
import pathlib
import re
import sys
import time

LIMIT_FILES = 2000
LIMIT_BYTES = 1024 * 1024
EXTENSIONS = {'.json', '.sql', '.py', '.sh', '.ktr', '.kjb'}
EXCLUDE_DIRS = {'.git', '.venv', 'venv', 'node_modules', 'target', 'dist', '__pycache__', 'backups', 'logs'}


def inspect(root):
    root = pathlib.Path(root).expanduser().resolve()
    if not root.is_dir():
        raise ValueError('目录不存在')
    files, warnings = [], []
    started=time.monotonic()
    count = 0
    def candidates():
        for directory, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith('.') and 'backup' not in d.lower()]
            for name in names:
                yield pathlib.Path(directory) / name
    for path in candidates():
        if time.monotonic()-started > 60:
            warnings.append("达到 60 秒扫描上限，请缩小目录范围")
            break
        if (not path.is_file() or path.suffix.lower() not in EXTENSIONS
                or path.name.startswith('.') or path.name.endswith(('.before.sql', '.after.sql'))):
            continue
        if set(path.relative_to(root).parts) & EXCLUDE_DIRS or not path.resolve().is_relative_to(root):
            continue
        count += 1
        if count > LIMIT_FILES:
            warnings.append('达到文件数量上限，请选择更具体的目录')
            break
        if path.stat().st_size > LIMIT_BYTES:
            warnings.append(str(path) + ': 文件超过 1MB，未读取')
            continue
        try:
            text = path.read_text(encoding='utf-8')
            record = {'path': str(path), 'references': [], 'sql': []}
            if path.suffix == '.json':
                value = json.loads(text)
                if not isinstance(value, dict) or not isinstance(value.get('job'), dict):
                    continue
                content = value['job'].get('content', [])
                cleaned = []
                for step in content:
                    item = {}
                    for direction in ('reader', 'writer'):
                        spec = step.get(direction, {})
                        params = spec.get('parameter', {})
                        connections = params.get('connection', [])
                        connections = connections if isinstance(connections, list) else [connections]
                        safe = []
                        for connection in connections:
                            c = {key: connection[key] for key in ('table', 'querySql') if key in connection}
                            urls = connection.get('jdbcUrl', [])
                            urls = urls if isinstance(urls, list) else [urls]
                            c['jdbcUrl'] = [re.sub(r'//[^/@]+@', '//', str(u).split('?')[0]) for u in urls]
                            safe.append(c)
                        item[direction] = {'name': spec.get('name', ''), 'parameter': {'connection': safe}}
                        if 'path' in params:
                            item[direction]['parameter']['path'] = params['path']
                    cleaned.append(item)
                if not cleaned:
                    continue
                record['datax'] = {'job': {'content': cleaned}}
            elif path.suffix in ('.ktr', '.kjb'):
                warnings.append(str(path) + ': 当前尚无 Kettle 步骤解析器')
                continue
            else:
                if path.suffix == '.sql':
                    record['sql'] = [text]
                if path.suffix == '.py':
                    try:
                        tree = ast.parse(text)
                        dynamic_parts = {id(n) for node in ast.walk(tree) if isinstance(node, ast.JoinedStr) for n in ast.walk(node)}
                        record['sql'] = [n.value for n in ast.walk(tree)
                                         if isinstance(n, ast.Constant) and isinstance(n.value, str)
                                         and id(n) not in dynamic_parts
                                         and re.match(r'^\s*(?:SELECT|WITH|INSERT\s+INTO|CREATE\s+TABLE|UPDATE)\b', n.value, re.I)]
                        if any(isinstance(n, ast.JoinedStr) and any(isinstance(v, ast.Constant) and isinstance(v.value, str) and re.search(r'\b(?:SELECT|INSERT|UPDATE|WITH)\b', v.value, re.I) for v in n.values) for n in ast.walk(tree)):
                            warnings.append(str(path) + ': 动态拼接 SQL 无法静态确定，已跳过')
                    except SyntaxError:
                        warnings.append(str(path) + ': Python 语法无法静态解析')
                record['references'] = sorted(set(re.findall(r'[\w./${}-]+\.(?:json|sql|sh|py|ktr|kjb)\b', text)))
                if not record['sql'] and not record['references']:
                    continue
            files.append(record)
        except (OSError, ValueError, TypeError) as exc:
            warnings.append(str(path) + ': ' + type(exc).__name__)
    return {'root': str(root), 'files': files, 'warnings': warnings}


if __name__ == '__main__':
    try:
        config = json.loads(sys.argv[1])
        print(json.dumps(inspect(config['root']), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
