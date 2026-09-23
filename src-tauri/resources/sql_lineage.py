import sys, json

def main():
    try:
        import sqlglot
        from sqlglot import exp
        dialect = (sys.argv[1] if len(sys.argv) > 1 else '').strip() or None
        trees = sqlglot.parse(sys.stdin.read(), read=dialect)
        flows = []
        for tree in trees:
            if tree is None:
                continue
            ctes = {c.alias for c in tree.find_all(exp.CTE)}
            def name(t):
                return '.'.join(p for p in (t.catalog, t.db, t.name) if p)
            target = None
            if isinstance(tree, (exp.Insert, exp.Create, exp.Update, exp.Merge)):
                table = tree.this
                if isinstance(table, exp.Schema):
                    table = table.this
                if isinstance(table, exp.Table):
                    target = name(table)
            sources = list(dict.fromkeys(name(t) for t in tree.find_all(exp.Table) if (t.db or t.name not in ctes) and name(t) != target))
            if sources or target:
                flows.append({'sources': sources, 'targets': [target] if target else []})
        sources = list(dict.fromkeys(s for f in flows for s in f['sources']))
        targets = list(dict.fromkeys(t for f in flows for t in f['targets']))
        print(json.dumps({'ok': True, 'target': targets[0] if len(targets)==1 else None, 'sources': sources, 'flows': flows}))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc), 'sources': [], 'flows': []}))

if __name__ == '__main__':
    main()
