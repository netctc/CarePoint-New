import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorCarePlanRpmPage extends StatefulWidget {
  const DoctorCarePlanRpmPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;

  @override
  State<DoctorCarePlanRpmPage> createState() => _DoctorCarePlanRpmPageState();
}

class _DoctorCarePlanRpmPageState extends State<DoctorCarePlanRpmPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> plans = const [];
  List<Map<String, dynamic>> alerts = const [];

  String t(String key) => doctorCarePlanRpmText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        widget.session.api.doctorPatientCarePlans(widget.patientId),
        widget.session.api.doctorMonitoringQueue(),
      ]);
      if (!mounted) return;
      setState(() {
        plans = _maps(_map(values[0])['items']);
        alerts = _maps(_map(values[1])['items']).where((item) => item['patientId']?.toString() == widget.patientId).toList(growable: false);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _createPlan() async {
    final title = TextEditingController();
    final summary = TextEditingController();
    final goal = TextEditingController();
    final criterion = TextEditingController();
    final effective = TextEditingController(text: _date(DateTime.now()));
    final review = TextEditingController(text: _date(DateTime.now().add(const Duration(days: 30))));
    String? validation;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
        title: Text(t('createPlan')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          _field(title, t('planTitle')),
          _gap(),
          _field(summary, t('summary'), maxLines: 3),
          _gap(),
          _field(effective, t('effectiveFrom'), hint: 'YYYY-MM-DD'),
          _gap(),
          _field(review, t('reviewAt'), hint: 'YYYY-MM-DD'),
          _gap(),
          _field(goal, t('initialGoal')),
          _gap(),
          _field(criterion, t('criterion'), maxLines: 2),
          if (validation != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () {
            if (title.text.trim().isEmpty || goal.text.trim().isEmpty || criterion.text.trim().isEmpty) {
              setDialogState(() => validation = t('required')); return;
            }
            if (_parseDate(effective.text) == null || _parseDate(review.text) == null) {
              setDialogState(() => validation = t('invalidDate')); return;
            }
            Navigator.pop(dialogContext, true);
          }, child: Text(t('save'))),
        ],
      )),
    );
    if (accepted != true) {
      for (final c in [title, summary, goal, criterion, effective, review]) { c.dispose(); }
      return;
    }
    try {
      final start = _toIso(effective.text)!;
      await widget.session.api.createDoctorCarePlan(widget.patientId, {
        'effectiveFrom': start,
        'reviewAt': _toIso(review.text),
        'data': {'title': title.text.trim(), if (summary.text.trim().isNotEmpty) 'summary': summary.text.trim()},
        'goals': [{
          'periodStart': start,
          'data': {'kind': 'QUALITATIVE', 'label': goal.text.trim(), 'criterion': criterion.text.trim()},
        }],
        'tasks': const [],
      });
      await _load();
    } on CarePointApiException catch (value) {
      _message(value.statusCode == 409 ? t('conflict') : value.toString());
    } catch (value) {
      _message(value.toString());
    } finally {
      for (final c in [title, summary, goal, criterion, effective, review]) { c.dispose(); }
    }
  }

  Future<void> _openPlan(Map<String, dynamic> plan) async {
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
      textDirection: widget.locale.textDirection,
      child: DoctorCarePlanDetailPage(session: widget.session, locale: widget.locale, plan: plan),
    )));
    if (mounted) await _load();
  }

  Future<void> _actAlert(Map<String, dynamic> alert, String action) async {
    String? reason;
    if (action == 'ESCALATE' || action == 'RESOLVE') {
      final controller = TextEditingController();
      final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(t(action.toLowerCase())),
        content: TextField(controller: controller, decoration: InputDecoration(labelText: t('reasonCode'), hintText: 'CLINICAL_REVIEW', border: const OutlineInputBorder())),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, controller.text.trim().isNotEmpty), child: Text(t('confirm'))),
        ],
      ));
      reason = controller.text.trim();
      controller.dispose();
      if (accepted != true || reason.isEmpty) return;
    }
    try {
      await widget.session.api.doctorClinicalAlertAction(alert['id'].toString(), action, reasonCode: reason);
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('title')), actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))]),
    floatingActionButton: FloatingActionButton.extended(onPressed: _createPlan, icon: const Icon(Icons.add), label: Text(t('createPlan'))),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(onRefresh: _load, child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                children: [
                  _section(t('rpmInbox'), Icons.monitor_heart_outlined),
                  if (alerts.isEmpty) Padding(padding: const EdgeInsets.only(bottom: 16), child: Text(t('noAlerts')))
                  else ...alerts.map((alert) => Card(child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.warning_amber_rounded),
                        title: Text('${alert['metricCode'] ?? ''} · ${alert['severity'] ?? ''}'),
                        subtitle: Text('${t('status')}: ${alert['status'] ?? ''}\n${t('created')}: ${_dateTime(alert['createdAt'])}'),
                        isThreeLine: true,
                      ),
                      Wrap(spacing: 8, runSpacing: 8, children: [
                        if (alert['status'] == 'OPEN') OutlinedButton(onPressed: () => _actAlert(alert, 'ACKNOWLEDGE'), child: Text(t('acknowledge'))),
                        OutlinedButton(onPressed: () => _actAlert(alert, 'ESCALATE'), child: Text(t('escalate'))),
                        FilledButton.tonal(onPressed: () => _actAlert(alert, 'RESOLVE'), child: Text(t('resolve'))),
                      ]),
                    ]),
                  ))),
                  const SizedBox(height: 12),
                  _section(t('carePlans'), Icons.assignment_outlined),
                  if (plans.isEmpty) Text(t('noPlans'))
                  else ...plans.map((plan) {
                    final data = _map(plan['data']);
                    return Card(child: ListTile(
                      leading: const Icon(Icons.assignment_turned_in_outlined),
                      title: Text(data['title']?.toString() ?? t('carePlan')),
                      subtitle: Text('${plan['status'] ?? ''} · ${t('version')} ${plan['version'] ?? ''}\n${data['summary'] ?? ''}'),
                      isThreeLine: true,
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _openPlan(plan),
                    ));
                  }),
                ],
              )),
  );

  Widget _section(String label, IconData icon) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(children: [Icon(icon), const SizedBox(width: 8), Text(label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))]),
  );

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

class DoctorCarePlanDetailPage extends StatefulWidget {
  const DoctorCarePlanDetailPage({super.key, required this.session, required this.locale, required this.plan});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> plan;

  @override
  State<DoctorCarePlanDetailPage> createState() => _DoctorCarePlanDetailPageState();
}

class _DoctorCarePlanDetailPageState extends State<DoctorCarePlanDetailPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> goals = const [];
  List<Map<String, dynamic>> tasks = const [];
  List<Map<String, dynamic>> rules = const [];
  List<Map<String, dynamic>> policies = const [];
  Map<String, dynamic> progress = const {};

  String get planId => widget.plan['id'].toString();
  String t(String key) => doctorCarePlanRpmText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        widget.session.api.doctorCarePlanGoals(planId),
        widget.session.api.doctorCarePlanTasks(planId),
        widget.session.api.doctorCarePlanProgress(planId),
        widget.session.api.doctorCarePlanAlertRules(planId),
        widget.session.api.doctorRpmPolicies(),
      ]);
      if (!mounted) return;
      setState(() {
        goals = _maps(_map(values[0])['items']);
        tasks = _maps(_map(values[1])['items']);
        progress = _map(values[2]);
        rules = _maps(_map(values[3])['items']);
        policies = _maps(_map(values[4])['items']);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _addGoal() async {
    final label = TextEditingController();
    final criterion = TextEditingController();
    final metric = TextEditingController();
    final target = TextEditingController();
    final unit = TextEditingController();
    final periodEnd = TextEditingController();
    String kind = 'QUALITATIVE';
    String comparator = 'GTE';
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
      title: Text(t('addGoal')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(initialValue: kind, decoration: InputDecoration(labelText: t('goalType')), items: const [
          DropdownMenuItem(value: 'QUALITATIVE', child: Text('QUALITATIVE')),
          DropdownMenuItem(value: 'MEASURABLE', child: Text('MEASURABLE')),
        ], onChanged: (v) => setDialogState(() => kind = v ?? kind)),
        _gap(), _field(label, t('goalLabel')), _gap(), _field(criterion, t('criterion'), maxLines: 2),
        if (kind == 'MEASURABLE') ...[
          _gap(), _field(metric, t('metricCode')),
          _gap(), DropdownButtonFormField<String>(initialValue: comparator, decoration: InputDecoration(labelText: t('comparator')), items: const [
            DropdownMenuItem(value: 'LT', child: Text('LT')), DropdownMenuItem(value: 'LTE', child: Text('LTE')),
            DropdownMenuItem(value: 'GT', child: Text('GT')), DropdownMenuItem(value: 'GTE', child: Text('GTE')),
          ], onChanged: (v) => setDialogState(() => comparator = v ?? comparator)),
          _gap(), _field(target, t('targetValue')), _gap(), _field(unit, t('unitCode')),
        ],
        _gap(), _field(periodEnd, t('periodEnd'), hint: 'YYYY-MM-DD (optional)'),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, label.text.trim().isNotEmpty && criterion.text.trim().isNotEmpty && (kind != 'MEASURABLE' || (metric.text.trim().isNotEmpty && double.tryParse(target.text.trim()) != null))), child: Text(t('save'))),
      ],
    )));
    if (accepted == true) {
      try {
        final data = <String, dynamic>{'kind': kind, 'label': label.text.trim(), 'criterion': criterion.text.trim()};
        if (kind == 'MEASURABLE') {
          data.addAll({'comparator': comparator, 'targetValue': double.parse(target.text.trim()), if (unit.text.trim().isNotEmpty) 'unitCode': unit.text.trim()});
        }
        await widget.session.api.addDoctorCarePlanGoal(planId, {
          'metricCode': metric.text.trim().isEmpty ? null : metric.text.trim().toUpperCase(),
          'periodStart': DateTime.now().toUtc().toIso8601String(),
          if (periodEnd.text.trim().isNotEmpty) 'periodEnd': _toIso(periodEnd.text),
          'data': data,
        });
        await _load();
      } catch (value) { _message(value.toString()); }
    }
    for (final c in [label, criterion, metric, target, unit, periodEnd]) { c.dispose(); }
  }

  Future<void> _addTask() async {
    final label = TextEditingController();
    final instructions = TextEditingController();
    final due = TextEditingController();
    String assignee = 'PATIENT';
    String kind = 'FOLLOW_UP';
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
      title: Text(t('addTask')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(initialValue: assignee, decoration: InputDecoration(labelText: t('assignee')), items: const [
          DropdownMenuItem(value: 'PATIENT', child: Text('PATIENT')), DropdownMenuItem(value: 'PROVIDER', child: Text('PROVIDER')),
        ], onChanged: (v) => setDialogState(() => assignee = v ?? assignee)),
        _gap(), DropdownButtonFormField<String>(initialValue: kind, decoration: InputDecoration(labelText: t('taskType')), items: const [
          DropdownMenuItem(value: 'MEASUREMENT', child: Text('MEASUREMENT')), DropdownMenuItem(value: 'EXERCISE', child: Text('EXERCISE')),
          DropdownMenuItem(value: 'MEDICATION', child: Text('MEDICATION')), DropdownMenuItem(value: 'EDUCATION', child: Text('EDUCATION')),
          DropdownMenuItem(value: 'FOLLOW_UP', child: Text('FOLLOW_UP')), DropdownMenuItem(value: 'OTHER', child: Text('OTHER')),
        ], onChanged: (v) => setDialogState(() => kind = v ?? kind)),
        _gap(), _field(label, t('taskLabel')), _gap(), _field(instructions, t('instructions'), maxLines: 3),
        _gap(), _field(due, t('dueAt'), hint: 'YYYY-MM-DD (optional)'),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, label.text.trim().isNotEmpty), child: Text(t('save'))),
      ],
    )));
    if (accepted == true) {
      try {
        await widget.session.api.addDoctorCarePlanTask(planId, {
          'assigneeType': assignee,
          if (due.text.trim().isNotEmpty) 'dueAt': _toIso(due.text),
          'data': {'kind': kind, 'label': label.text.trim(), if (instructions.text.trim().isNotEmpty) 'instructions': instructions.text.trim()},
        });
        await _load();
      } catch (value) { _message(value.toString()); }
    }
    for (final c in [label, instructions, due]) { c.dispose(); }
  }

  Future<void> _addRule() async {
    if (policies.isEmpty) { _message(t('noPolicies')); return; }
    String policyVersionId = policies.first['policyVersionId'].toString();
    final metric = TextEditingController();
    final threshold = TextEditingController();
    final actionKey = TextEditingController();
    String severity = 'WARNING';
    String comparator = 'GT';
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
      title: Text(t('addRule')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(
          initialValue: policyVersionId,
          decoration: InputDecoration(labelText: t('policy')),
          items: policies.map((p) => DropdownMenuItem(value: p['policyVersionId'].toString(), child: Text(p['code']?.toString() ?? p['policyVersionId'].toString()))).toList(),
          onChanged: (v) => setDialogState(() => policyVersionId = v ?? policyVersionId),
        ),
        _gap(), _field(metric, t('metricCode')),
        _gap(), DropdownButtonFormField<String>(initialValue: severity, decoration: InputDecoration(labelText: t('severity')), items: const [
          DropdownMenuItem(value: 'INFO', child: Text('INFO')), DropdownMenuItem(value: 'WARNING', child: Text('WARNING')), DropdownMenuItem(value: 'CRITICAL', child: Text('CRITICAL')),
        ], onChanged: (v) => setDialogState(() => severity = v ?? severity)),
        _gap(), DropdownButtonFormField<String>(initialValue: comparator, decoration: InputDecoration(labelText: t('comparator')), items: const [
          DropdownMenuItem(value: 'LT', child: Text('LT')), DropdownMenuItem(value: 'LTE', child: Text('LTE')),
          DropdownMenuItem(value: 'GT', child: Text('GT')), DropdownMenuItem(value: 'GTE', child: Text('GTE')),
        ], onChanged: (v) => setDialogState(() => comparator = v ?? comparator)),
        _gap(), _field(threshold, t('threshold')),
        _gap(), _field(actionKey, t('patientActionKey')),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, metric.text.trim().isNotEmpty && actionKey.text.trim().isNotEmpty && double.tryParse(threshold.text.trim()) != null), child: Text(t('save'))),
      ],
    )));
    if (accepted == true) {
      try {
        await widget.session.api.createDoctorCarePlanAlertRule(planId, {
          'policyVersionId': policyVersionId,
          'metricCode': metric.text.trim().toUpperCase(),
          'severity': severity,
          'patientActionKey': actionKey.text.trim().toUpperCase(),
          'effectiveFrom': DateTime.now().toUtc().toIso8601String(),
          'rule': {'comparator': comparator, 'thresholdValue': double.parse(threshold.text.trim())},
        });
        await _load();
      } catch (value) { _message(value.toString()); }
    }
    for (final c in [metric, threshold, actionKey]) { c.dispose(); }
  }

  @override
  Widget build(BuildContext context) {
    final planData = _map(widget.plan['data']);
    final tasksProgress = _map(progress['tasks']);
    final goalsProgress = _map(progress['goals']);
    return Scaffold(
      appBar: AppBar(title: Text(planData['title']?.toString() ?? t('carePlan')), actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined))]),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
              : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
                  Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(t('progress'), style: const TextStyle(fontWeight: FontWeight.w900)),
                    Text('${t('taskCompletions')}: ${tasksProgress['completionEvents'] ?? 0} · ${t('done')}: ${tasksProgress['done'] ?? 0} · ${t('omitted')}: ${tasksProgress['omitted'] ?? 0}'),
                    Text('${t('goals')}: ${goalsProgress['total'] ?? 0} · ${t('active')}: ${goalsProgress['active'] ?? 0} · ${t('achieved')}: ${goalsProgress['achieved'] ?? 0}'),
                    Text(t('deterministicHint'), style: const TextStyle(color: Color(0xFF64748B))),
                  ]))),
                  const SizedBox(height: 10),
                  _header(t('goals'), () => _addGoal()),
                  if (goals.isEmpty) Text(t('empty')) else ...goals.map((goal) {
                    final data = _map(goal['data']);
                    return Card(child: ListTile(title: Text(data['label']?.toString() ?? ''), subtitle: Text('${data['criterion'] ?? ''}\n${goal['status'] ?? ''} · ${goal['metricCode'] ?? data['kind'] ?? ''}'), isThreeLine: true));
                  }),
                  _header(t('tasks'), () => _addTask()),
                  if (tasks.isEmpty) Text(t('empty')) else ...tasks.map((task) {
                    final data = _map(task['data']);
                    return Card(child: ListTile(title: Text(data['label']?.toString() ?? ''), subtitle: Text('${task['assigneeType'] ?? ''} · ${task['status'] ?? ''}\n${data['instructions'] ?? ''}'), isThreeLine: true));
                  }),
                  _header(t('alertRules'), () => _addRule()),
                  if (rules.isEmpty) Text(t('empty')) else ...rules.map((rule) => Card(child: ListTile(
                    title: Text('${rule['metricCode'] ?? ''} · ${rule['severity'] ?? ''}'),
                    subtitle: Text('${rule['status'] ?? ''} · ${rule['patientActionKey'] ?? ''}\n${_map(rule['rule'])['comparator'] ?? ''} ${_map(rule['rule'])['thresholdValue'] ?? ''}'),
                    isThreeLine: true,
                  ))),
                ])),
    );
  }

  Widget _header(String label, VoidCallback add) => Padding(
    padding: const EdgeInsets.fromLTRB(2, 16, 2, 6),
    child: Row(children: [
      Expanded(child: Text(label, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900))),
      IconButton(onPressed: add, icon: const Icon(Icons.add_circle_outline)),
    ]),
  );

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

Widget _field(TextEditingController controller, String label, {String? hint, int maxLines = 1}) =>
    TextField(controller: controller, maxLines: maxLines, decoration: InputDecoration(labelText: label, hintText: hint, border: const OutlineInputBorder()));
Widget _gap() => const SizedBox(height: 10);

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return const {};
}
List<Map<String, dynamic>> _maps(dynamic value) => value is List ? value.map(_map).toList(growable: false) : const [];

DateTime? _parseDate(String value) {
  final text = value.trim();
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) return null;
  return DateTime.tryParse(text);
}
String? _toIso(String value) {
  final parsed = _parseDate(value);
  return parsed == null ? null : DateTime.utc(parsed.year, parsed.month, parsed.day, 12).toIso8601String();
}
String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
String _dateTime(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  return parsed == null ? '—' : '${_date(parsed)} ${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
}

String doctorCarePlanRpmText(CarePointLocale locale, String key) =>
    _text[locale]?[key] ?? _text[CarePointLocale.en]?[key] ?? key;

const Map<CarePointLocale, Map<String, String>> _text = {
  CarePointLocale.en: {
    'title':'Care Plans & RPM','missingPatient':'Patient context is unavailable.','carePlans':'Care Plans','carePlan':'Care Plan','createPlan':'Create Care Plan',
    'planTitle':'Plan title','summary':'Summary','effectiveFrom':'Effective from','reviewAt':'Review date','initialGoal':'Initial goal','criterion':'Success criterion',
    'save':'Save','cancel':'Cancel','confirm':'Confirm','required':'Complete all required fields.','invalidDate':'Use YYYY-MM-DD dates.','conflict':'The record changed. Latest data was reloaded.',
    'noPlans':'No Care Plans.','rpmInbox':'RPM monitoring inbox','noAlerts':'No open alerts for this patient.','status':'Status','created':'Created',
    'acknowledge':'Acknowledge','escalate':'Escalate','resolve':'Resolve','reasonCode':'Reason code','version':'v','refresh':'Refresh',
    'progress':'Deterministic progress','taskCompletions':'Task completions','done':'Done','omitted':'Omitted','goals':'Goals','active':'Active','achieved':'Achieved',
    'deterministicHint':'Progress is calculated from recorded completions and observations; no autonomous clinical inference is used.',
    'addGoal':'Add goal','goalType':'Goal type','goalLabel':'Goal label','metricCode':'Metric code','comparator':'Comparator','targetValue':'Target value','unitCode':'Unit code','periodEnd':'Period end',
    'tasks':'Tasks','addTask':'Add task','assignee':'Assignee','taskType':'Task type','taskLabel':'Task label','instructions':'Instructions','dueAt':'Due date',
    'alertRules':'RPM alert rules','addRule':'Add alert rule','policy':'Active policy','severity':'Severity','threshold':'Threshold','patientActionKey':'Patient action key','noPolicies':'No active RPM policy is available.',
    'empty':'Nothing recorded yet.'
  },
  CarePointLocale.ar: {
    'title':'خطط الرعاية والمراقبة','missingPatient':'سياق المريض غير متاح.','carePlans':'خطط الرعاية','carePlan':'خطة رعاية','createPlan':'إنشاء خطة رعاية',
    'planTitle':'عنوان الخطة','summary':'الملخص','effectiveFrom':'تاريخ البدء','reviewAt':'تاريخ المراجعة','initialGoal':'الهدف الأولي','criterion':'معيار النجاح',
    'save':'حفظ','cancel':'إلغاء','confirm':'تأكيد','required':'أكمل الحقول المطلوبة.','invalidDate':'استخدم التاريخ بصيغة YYYY-MM-DD.','conflict':'تم تغيير السجل وتم تحميل أحدث البيانات.',
    'noPlans':'لا توجد خطط رعاية.','rpmInbox':'صندوق تنبيهات المراقبة','noAlerts':'لا توجد تنبيهات مفتوحة لهذا المريض.','status':'الحالة','created':'الإنشاء',
    'acknowledge':'تأكيد الاستلام','escalate':'تصعيد','resolve':'حل','reasonCode':'رمز السبب','version':'إصدار','refresh':'تحديث',
    'progress':'التقدم الحتمي','taskCompletions':'إكمال المهام','done':'تم','omitted':'متروك','goals':'الأهداف','active':'نشط','achieved':'محقق',
    'deterministicHint':'يُحسب التقدم من عمليات الإكمال والقياسات المسجلة دون استدلال سريري آلي.',
    'addGoal':'إضافة هدف','goalType':'نوع الهدف','goalLabel':'وصف الهدف','metricCode':'رمز القياس','comparator':'المقارنة','targetValue':'القيمة المستهدفة','unitCode':'رمز الوحدة','periodEnd':'نهاية الفترة',
    'tasks':'المهام','addTask':'إضافة مهمة','assignee':'المسؤول','taskType':'نوع المهمة','taskLabel':'عنوان المهمة','instructions':'التعليمات','dueAt':'تاريخ الاستحقاق',
    'alertRules':'قواعد تنبيهات المراقبة','addRule':'إضافة قاعدة تنبيه','policy':'السياسة النشطة','severity':'الشدة','threshold':'الحد','patientActionKey':'إجراء المريض','noPolicies':'لا توجد سياسة مراقبة نشطة.',
    'empty':'لا توجد بيانات بعد.'
  },
  CarePointLocale.fr: {
    'title':'Plans de soins et RPM','missingPatient':'Le contexte patient est indisponible.','carePlans':'Plans de soins','carePlan':'Plan de soins','createPlan':'Créer un plan de soins',
    'planTitle':'Titre du plan','summary':'Résumé','effectiveFrom':'Début','reviewAt':'Date de revue','initialGoal':'Objectif initial','criterion':'Critère de réussite',
    'save':'Enregistrer','cancel':'Annuler','confirm':'Confirmer','required':'Complétez les champs obligatoires.','invalidDate':'Utilisez des dates YYYY-MM-DD.','conflict':'Le dossier a changé. Les dernières données ont été rechargées.',
    'noPlans':'Aucun plan de soins.','rpmInbox':'File de surveillance RPM','noAlerts':'Aucune alerte ouverte pour ce patient.','status':'Statut','created':'Créée',
    'acknowledge':'Accuser réception','escalate':'Escalader','resolve':'Résoudre','reasonCode':'Code motif','version':'v','refresh':'Actualiser',
    'progress':'Progression déterministe','taskCompletions':'Tâches terminées','done':'Fait','omitted':'Omis','goals':'Objectifs','active':'Actifs','achieved':'Atteints',
    'deterministicHint':'La progression repose sur les tâches et mesures enregistrées, sans inférence clinique autonome.',
    'addGoal':'Ajouter un objectif','goalType':'Type d’objectif','goalLabel':'Libellé','metricCode':'Code métrique','comparator':'Comparateur','targetValue':'Valeur cible','unitCode':'Unité','periodEnd':'Fin de période',
    'tasks':'Tâches','addTask':'Ajouter une tâche','assignee':'Assignée à','taskType':'Type de tâche','taskLabel':'Libellé','instructions':'Instructions','dueAt':'Échéance',
    'alertRules':'Règles RPM','addRule':'Ajouter une règle','policy':'Politique active','severity':'Sévérité','threshold':'Seuil','patientActionKey':'Action patient','noPolicies':'Aucune politique RPM active.',
    'empty':'Aucune donnée.'
  },
  CarePointLocale.es: {
    'title':'Planes de cuidados y RPM','missingPatient':'No está disponible el contexto del paciente.','carePlans':'Planes de cuidados','carePlan':'Plan de cuidados','createPlan':'Crear plan de cuidados',
    'planTitle':'Título del plan','summary':'Resumen','effectiveFrom':'Fecha de inicio','reviewAt':'Fecha de revisión','initialGoal':'Objetivo inicial','criterion':'Criterio de éxito',
    'save':'Guardar','cancel':'Cancelar','confirm':'Confirmar','required':'Completa los campos obligatorios.','invalidDate':'Usa fechas YYYY-MM-DD.','conflict':'El registro cambió. Se han recargado los últimos datos.',
    'noPlans':'No hay planes de cuidados.','rpmInbox':'Bandeja de monitorización RPM','noAlerts':'No hay alertas abiertas para este paciente.','status':'Estado','created':'Creada',
    'acknowledge':'Reconocer','escalate':'Escalar','resolve':'Resolver','reasonCode':'Código de motivo','version':'v','refresh':'Actualizar',
    'progress':'Progreso determinista','taskCompletions':'Tareas completadas','done':'Hechas','omitted':'Omitidas','goals':'Objetivos','active':'Activos','achieved':'Alcanzados',
    'deterministicHint':'El progreso se calcula con tareas y observaciones registradas, sin inferencia clínica autónoma.',
    'addGoal':'Añadir objetivo','goalType':'Tipo de objetivo','goalLabel':'Nombre del objetivo','metricCode':'Código métrico','comparator':'Comparador','targetValue':'Valor objetivo','unitCode':'Código de unidad','periodEnd':'Fin del periodo',
    'tasks':'Tareas','addTask':'Añadir tarea','assignee':'Responsable','taskType':'Tipo de tarea','taskLabel':'Nombre de tarea','instructions':'Instrucciones','dueAt':'Vencimiento',
    'alertRules':'Reglas de alerta RPM','addRule':'Añadir regla','policy':'Política activa','severity':'Severidad','threshold':'Umbral','patientActionKey':'Acción del paciente','noPolicies':'No hay una política RPM activa.',
    'empty':'Todavía no hay datos.'
  },
};
