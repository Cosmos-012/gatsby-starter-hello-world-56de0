#!/usr/bin/env python3
"""Crée (ou met à jour) dans Superset la source de données d'UN tenant et le tableau de bord « NED M&E », à partir des vues `bi`.

Idempotent : relancer met à jour sans dupliquer. Une exécution = un tenant = un compte BI (voir docs/BI.md).
Langues : français ou anglais (pas d'arabe : l'interface Superset n'est pas inversée). Les libellés de statut viennent des catalogues de
l'interface NED (web/messages), pour que l'analyste voie les mêmes mots que sur la première page.

Variables d'environnement : SUPERSET_URL (défaut http://127.0.0.1:8088), SUPERSET_ADMIN, SUPERSET_PASSWORD, BI_URI (URI SQLAlchemy du compte bi_*).
Bibliothèque standard uniquement.
"""
import argparse, http.cookiejar, json, os, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LANGS = ('fr', 'en')

# ---- Libellés : statuts depuis les catalogues de l'interface ; le reste est propre aux graphiques (fr / en) ----
def catalog(lang):
    return json.loads((HERE.parent.parent / 'web' / 'messages' / f'{lang}.json').read_text(encoding='utf-8'))

TXT = {
    'fr': {
        'dashboard': 'NED M&E — Performance du projet', 'achievement_rate': 'Taux d\'atteinte', 'overall': 'Performance globale', 'coverage': 'Couverture des données', 'satisfaction': 'Satisfaction moyenne (sur 5)',
        'by_status': 'Indicateurs par statut', 'achievement': "Taux d'atteinte par indicateur", 'risks_level': 'Risques actifs par niveau', 'risks_table': 'Risques actifs',
        'dq': 'Anomalies de qualité des données ouvertes', 'feedback': 'Retours ouverts par statut et type', 'recs': 'Recommandations par statut', 'tracking': 'Table de suivi des indicateurs',
        'level': {'critical': 'Critique', 'high': 'Élevé', 'medium': 'Moyen', 'low': 'Faible'},
        'severity': {'error': 'Erreur', 'warning': 'Avertissement'},
        'dimension': {'accuracy': 'Exactitude', 'completeness': 'Complétude', 'consistency': 'Cohérence', 'timeliness': 'Ponctualité', 'validity': 'Validité', 'reliability': 'Fiabilité'},
        'fb_status': {'received': 'Reçu', 'acknowledged': 'Accusé', 'investigating': 'En instruction', 'escalated': 'Escaladé', 'resolved': 'Résolu', 'closed': 'Clos'},
        'fb_kind': {'feedback': 'Retour', 'complaint': 'Plainte', 'grievance': 'Réclamation', 'suggestion': 'Suggestion'},
        'rec_status': {'open': 'Sans réponse', 'responded': 'Répondue', 'in_progress': 'En cours', 'closed': 'Clôturée'},
    },
    'en': {
        'dashboard': 'NED M&E — Project performance', 'achievement_rate': 'Achievement rate', 'overall': 'Overall performance', 'coverage': 'Data coverage', 'satisfaction': 'Average satisfaction (out of 5)',
        'by_status': 'Indicators by status', 'achievement': 'Achievement by indicator', 'risks_level': 'Active risks by level', 'risks_table': 'Active risks',
        'dq': 'Open data quality issues', 'feedback': 'Open feedback by status and type', 'recs': 'Recommendations by status', 'tracking': 'Indicator tracking table',
        'level': {'critical': 'Critical', 'high': 'High', 'medium': 'Medium', 'low': 'Low'},
        'severity': {'error': 'Error', 'warning': 'Warning'},
        'dimension': {'accuracy': 'Accuracy', 'completeness': 'Completeness', 'consistency': 'Consistency', 'timeliness': 'Timeliness', 'validity': 'Validity', 'reliability': 'Reliability'},
        'fb_status': {'received': 'Received', 'acknowledged': 'Acknowledged', 'investigating': 'Investigating', 'escalated': 'Escalated', 'resolved': 'Resolved', 'closed': 'Closed'},
        'fb_kind': {'feedback': 'Feedback', 'complaint': 'Complaint', 'grievance': 'Grievance', 'suggestion': 'Suggestion'},
        'rec_status': {'open': 'No response', 'responded': 'Responded', 'in_progress': 'In progress', 'closed': 'Closed'},
    },
}
# Couleurs réservées aux statuts, identiques à l'interface NED (web/src/app/globals.css)
STATUS_COLORS = {'GREEN': '#0ca30c', 'AMBER': '#fab219', 'RED': '#d03b3b', 'GREY': '#8a8984'}

def sql_str(s): return "'" + s.replace("'", "''") + "'"

def case_label(column, mapping):
    """Expression SQL qui traduit un code en libellé (les libellés viennent de dictionnaires fixes du dépôt, échappés)."""
    whens = ' '.join(f"WHEN {sql_str(k)} THEN {sql_str(v)}" for k, v in mapping.items())
    return f"CASE {column} {whens} ELSE {column} END"

# ---- Client REST ----
class Superset:
    def __init__(self, base):
        self.base = base.rstrip('/'); self.jwt = None; self.csrf = None
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def call(self, method, path, body=None):
        h = {'Content-Type': 'application/json'}
        if self.jwt: h['Authorization'] = 'Bearer ' + self.jwt
        if self.csrf and method != 'GET': h['X-CSRFToken'] = self.csrf; h['Referer'] = self.base
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=h, method=method)
        try:
            r = self.op.open(req, timeout=120); return r.status, json.loads(r.read() or b'null')
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors='replace')
            try: return e.code, json.loads(raw)
            except ValueError: return e.code, raw[:400]
    def login(self, user, password):
        s, d = self.call('POST', '/api/v1/security/login', {'username': user, 'password': password, 'provider': 'db', 'refresh': True})
        if s != 200: raise SystemExit(f'connexion à Superset refusée (HTTP {s}) : {d}')
        self.jwt = d['access_token']; self.csrf = self.call('GET', '/api/v1/security/csrf_token/')[1]['result']
    def find(self, resource, col, value, extra=None):
        flt = [{'col': col, 'opr': 'eq', 'value': value}] + (extra or [])
        s, d = self.call('GET', f'/api/v1/{resource}/?q=' + urllib.parse.quote(json.dumps({'filters': flt})))
        return d['result'][0]['id'] if s == 200 and d.get('result') else None
    def upsert(self, resource, found, body, label):
        s, d = self.call('PUT', f'/api/v1/{resource}/{found}', body) if found else self.call('POST', f'/api/v1/{resource}/', body)
        if s not in (200, 201): raise SystemExit(f'{label} : échec (HTTP {s}) {json.dumps(d, ensure_ascii=False)[:500]}')
        return found or d['id']

# ---- Définition du tableau de bord ----
def metric(sql, label): return {'expressionType': 'SQL', 'sqlExpression': sql, 'label': label}
def flt(sql): return {'expressionType': 'SQL', 'clause': 'WHERE', 'sqlExpression': sql}
def col(sql, label): return {'expressionType': 'SQL', 'sqlExpression': sql, 'label': label}

def charts(t, cat):
    st = {k: cat[f'status.{k}'] for k in STATUS_COLORS}
    ACTIVE = "status IN ('open','mitigating','accepted')"
    common = {'adhoc_filters': [], 'time_range': 'No filter', 'row_limit': 1000}
    return [  # (clé, jeu de données, type, paramètres, ligne, largeur, hauteur)
        ('overall', 'indicator_progress', 'big_number_total', {'metric': metric('AVG(CASE WHEN achievement IS NOT NULL THEN LEAST(1, GREATEST(0, achievement)) END)', 'performance'), 'y_axis_format': '.1%', 'subheader': ''}, 1, 4, 24),
        ('coverage', 'indicator_progress', 'big_number_total', {'metric': metric('COUNT(achievement) * 1.0 / NULLIF(COUNT(*), 0)', 'coverage'), 'y_axis_format': '.0%'}, 1, 4, 24),
        ('satisfaction', 'feedback', 'big_number_total', {'metric': metric('AVG(satisfaction_score)', 'satisfaction'), 'y_axis_format': '.2f', 'adhoc_filters': [flt("kind = 'satisfaction'")]}, 1, 4, 24),
        ('by_status', 'indicator_progress', 'pie', {'groupby': [col(case_label('status', st), 'statut')], 'metric': metric('COUNT(*)', 'n'), 'show_labels': True, 'label_type': 'key_value', 'show_legend': True}, 2, 4, 50),
        ('achievement', 'indicator_progress', 'echarts_timeseries_bar', {'x_axis': 'code', 'metrics': [metric('MAX(achievement)', t['achievement_rate'])], 'groupby': [], 'y_axis_format': '.0%', 'adhoc_filters': [flt('achievement IS NOT NULL')], 'orientation': 'vertical', 'x_axis_sort_asc': True}, 2, 8, 50),
        ('risks_level', 'risks', 'pie', {'groupby': [col(case_label('level', t['level']), 'niveau')], 'metric': metric('COUNT(*)', 'n'), 'adhoc_filters': [flt(ACTIVE)], 'show_labels': True, 'label_type': 'key_value'}, 3, 4, 50),
        ('risks_table', 'risks', 'table', {'query_mode': 'raw', 'all_columns': ['code', 'title', 'level', 'score', 'status', 'escalation_level'], 'adhoc_filters': [flt(ACTIVE)], 'order_by_cols': [json.dumps(['score', False])], 'row_limit': 50, 'include_search': False}, 3, 8, 50),
        ('dq', 'dq_issues', 'echarts_timeseries_bar', {'x_axis': col(case_label('dimension', t['dimension']), 'dimension'), 'metrics': [metric('COUNT(*)', 'n')], 'groupby': [col(case_label('severity', t['severity']), 'gravité')], 'adhoc_filters': [flt("status = 'open'")], 'stack': True, 'orientation': 'vertical'}, 4, 6, 50),
        ('feedback', 'feedback', 'echarts_timeseries_bar', {'x_axis': col(case_label('status', t['fb_status']), 'statut'), 'metrics': [metric('COUNT(*)', 'n')], 'groupby': [col(case_label('kind', t['fb_kind']), 'type')], 'adhoc_filters': [flt("kind <> 'satisfaction' AND status NOT IN ('resolved','closed')")], 'stack': True, 'orientation': 'vertical'}, 4, 6, 50),
        ('recs', 'recommendations', 'pie', {'groupby': [col(case_label('status', t['rec_status']), 'statut')], 'metric': metric('COUNT(*)', 'n'), 'show_labels': True, 'label_type': 'key_value'}, 5, 4, 50),
        ('tracking', 'indicator_progress', 'table', {'query_mode': 'raw', 'all_columns': ['code', 'period', 'actual', 'target', 'gap', 'achievement', 'status'], 'order_by_cols': [json.dumps(['achievement', True])], 'row_limit': 200, 'include_search': True}, 5, 8, 50),
    ], common

def position(title, placed):
    """placed : liste (clé, id graphique, nom, ligne, largeur, hauteur)."""
    pos = {'DASHBOARD_VERSION_KEY': 'v2', 'ROOT_ID': {'type': 'ROOT', 'id': 'ROOT_ID', 'children': ['GRID_ID']},
           'GRID_ID': {'type': 'GRID', 'id': 'GRID_ID', 'children': [], 'parents': ['ROOT_ID']},
           'HEADER_ID': {'id': 'HEADER_ID', 'type': 'HEADER', 'meta': {'text': title}}}
    for row in sorted({p[3] for p in placed}):
        rid = f'ROW-{row}'; pos['GRID_ID']['children'].append(rid)
        pos[rid] = {'type': 'ROW', 'id': rid, 'children': [], 'parents': ['ROOT_ID', 'GRID_ID'], 'meta': {'background': 'BACKGROUND_TRANSPARENT'}}
        for key, cid, name, _, w, h in (p for p in placed if p[3] == row):
            cmp = f'CHART-{key}'; pos[rid]['children'].append(cmp)
            pos[cmp] = {'type': 'CHART', 'id': cmp, 'children': [], 'parents': ['ROOT_ID', 'GRID_ID', rid], 'meta': {'width': w, 'height': h, 'chartId': cid, 'sliceName': name}}
    return pos

VIEWS = ('indicator_progress', 'risks', 'dq_issues', 'feedback', 'recommendations')

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--lang', choices=LANGS, default='fr', help='fr ou en (pas d\'arabe)')
    ap.add_argument('--source-name', required=True, help='nom de la source de données Superset (ex. « NED — Projet SNN »)')
    ap.add_argument('--slug', default='ned-me', help='identifiant d\'URL du tableau de bord')
    a = ap.parse_args()
    uri = os.environ.get('BI_URI') or sys.exit('BI_URI requis (URI du compte bi_*, voir deploy/bi-account.sh)')
    if not urllib.parse.urlparse(uri).username or not urllib.parse.urlparse(uri).username.startswith('bi_'):
        sys.exit("BI_URI doit utiliser un compte bi_* : jamais un compte propriétaire ni ned_app (voir docs/BI.md)")
    t, cat = TXT[a.lang], catalog(a.lang)
    s = Superset(os.environ.get('SUPERSET_URL', 'http://127.0.0.1:8088'))
    s.login(os.environ.get('SUPERSET_ADMIN', 'admin'), os.environ.get('SUPERSET_PASSWORD') or sys.exit('SUPERSET_PASSWORD requis'))

    db = s.upsert('database', s.find('database', 'database_name', a.source_name),
                  {'database_name': a.source_name, 'sqlalchemy_uri': uri, 'expose_in_sqllab': True, 'allow_dml': False, 'allow_file_upload': False, 'allow_ctas': False, 'allow_cvas': False}, 'source de données')
    datasets = {}
    for v in VIEWS:
        datasets[v] = s.find('dataset', 'table_name', v, [{'col': 'database', 'opr': 'rel_o_m', 'value': db}]) or s.upsert('dataset', None, {'database': db, 'schema': 'bi', 'table_name': v}, f'jeu de données {v}')

    dash_title = t['dashboard']
    dash = s.find('dashboard', 'slug', a.slug)
    meta = {'color_scheme': 'supersetColors', 'label_colors': {**{cat[f'status.{k}']: c for k, c in STATUS_COLORS.items()}, **{v: c for v, c in zip(t['level'].values(), ['#d03b3b', '#ec835a', '#fab219', '#8a8984'])}},
            'refresh_frequency': 0, 'expanded_slices': {}, 'timed_refresh_immune_slices': [], 'default_filters': '{}', 'shared_label_colors': {}, 'color_scheme_domain': []}
    dash = s.upsert('dashboard', dash, {'dashboard_title': dash_title, 'slug': a.slug, 'published': True, 'json_metadata': json.dumps(meta)}, 'tableau de bord')

    defs, common = charts(t, cat); placed = []
    for key, view, viz, params, row, w, h in defs:
        name = t[key] if key in t else key
        form = {**common, **params, 'viz_type': viz, 'datasource': f'{datasets[view]}__table'}
        cid = s.upsert('chart', s.find('chart', 'slice_name', name, [{'col': 'datasource_id', 'opr': 'eq', 'value': datasets[view]}]),
                       {'slice_name': name, 'viz_type': viz, 'datasource_id': datasets[view], 'datasource_type': 'table', 'params': json.dumps(form), 'dashboards': [dash]}, f'graphique « {name} »')
        placed.append((key, cid, name, row, w, h))
    s.upsert('dashboard', dash, {'position_json': json.dumps(position(dash_title, placed)), 'json_metadata': json.dumps({**meta, 'positions': position(dash_title, placed)})}, 'disposition')
    out = {'database_id': db, 'dashboard_id': dash, 'url': f"{s.base}/superset/dashboard/{a.slug}/", 'charts': {p[0]: p[1] for p in placed}, 'datasets': datasets}
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
