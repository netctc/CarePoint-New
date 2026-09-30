import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class ProviderSuppliesLauncher extends StatelessWidget {
  const ProviderSuppliesLauncher({
    super.key,
    required this.child,
    required this.session,
    required this.locale,
    required this.workflowCapabilities,
    required this.accent,
  });

  final Widget child;
  final CarePointSession session;
  final CarePointLocale locale;
  final Set<String> workflowCapabilities;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    if (!workflowCapabilities.contains('SUPPLY_TRACKING')) return child;
    return Stack(children: [
      child,
      PositionedDirectional(
        end: 76,
        bottom: 92,
        child: FloatingActionButton.small(
          heroTag: 'provider-supplies',
          backgroundColor: accent,
          foregroundColor: Colors.white,
          tooltip: providerSuppliesText(locale, 'title'),
          onPressed: () => Navigator.push<void>(
            context,
            MaterialPageRoute(
              builder: (_) => Directionality(
                textDirection: locale.textDirection,
                child: ProviderSuppliesPage(session: session, locale: locale, accent: accent),
              ),
            ),
          ),
          child: const Icon(Icons.inventory_2_outlined),
        ),
      ),
    ]);
  }
}

class ProviderSuppliesPage extends StatefulWidget {
  const ProviderSuppliesPage({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  @override
  State<ProviderSuppliesPage> createState() => _ProviderSuppliesPageState();
}

class _ProviderSuppliesPageState extends State<ProviderSuppliesPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> jobs = const [];
  List<Map<String, dynamic>> catalog = const [];
  List<Map<String, dynamic>> usages = const [];
  String? selectedJobId;

  CarePointApi get api => widget.session.api;
  String t(String key) => providerSuppliesText(widget.locale, key);

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([api.providerFieldJobs(), api.providerSupplyCatalog()]);
      final nextJobs = _maps(values[0]['items']);
      final nextCatalog = _maps(values[1]['items']);
      final current = selectedJobId;
      final nextJobId = current != null && nextJobs.any((item) => item['id']?.toString() == current)
          ? current
          : (nextJobs.isEmpty ? null : nextJobs.first['id']?.toString());
      if (!mounted) return;
      setState(() { jobs = nextJobs; catalog = nextCatalog; selectedJobId = nextJobId; });
      if (nextJobId != null) await _loadUsage(nextJobId);
      else if (mounted) setState(() => usages = const []);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _loadUsage(String jobId) async {
    try {
      final result = await api.providerJobSupplies(jobId);
      if (mounted && selectedJobId == jobId) setState(() => usages = _maps(result['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    }
  }

  Map<String, dynamic>? get _selectedJob {
    final id = selectedJobId;
    if (id == null) return null;
    for (final item in jobs) {
      if (item['id']?.toString() == id) return item;
    }
    return null;
  }

  bool get _jobWritable {
    final job = _selectedJob;
    if (job == null) return false;
    final type = job['sourceType']?.toString();
    final status = job['sourceStatus']?.toString();
    if (type == 'HOME_VISIT') return status == 'CONFIRMED';
    return type == 'MEDICAL_TRANSPORT' && const {'ASSIGNED','EN_ROUTE','ARRIVED','TRANSPORTING'}.contains(status);
  }

  Future<void> _record() async {
    final jobId = selectedJobId;
    if (jobId == null || catalog.isEmpty || !_jobWritable) return;
    String supplyItemId = catalog.first['id'].toString();
    final quantity = TextEditingController(text: '1');
    String? validation;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) {
          final item = catalog.firstWhere((value) => value['id']?.toString() == supplyItemId);
          return AlertDialog(
            title: Text(t('record')),
            content: Column(mainAxisSize: MainAxisSize.min, children: [
              DropdownButtonFormField<String>(
                initialValue: supplyItemId,
                decoration: InputDecoration(labelText: t('item')),
                items: catalog.map((entry) => DropdownMenuItem(
                  value: entry['id'].toString(),
                  child: Text('${_label(entry['labels'], widget.locale, entry['code']?.toString() ?? '')} · ${entry['unitCode'] ?? ''}'),
                )).toList(growable: false),
                onChanged: (value) => setLocal(() => supplyItemId = value ?? supplyItemId),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: quantity,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: t('quantity'),
                  suffixText: item['unitCode']?.toString(),
                  border: const OutlineInputBorder(),
                ),
              ),
              if (validation != null) Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
              FilledButton(onPressed: () {
                final parsed = num.tryParse(quantity.text.trim());
                if (parsed == null || parsed <= 0) {
                  setLocal(() => validation = t('invalidQuantity'));
                  return;
                }
                Navigator.pop(dialogContext, true);
              }, child: Text(t('save'))),
            ],
          );
        },
      ),
    );
    if (accepted != true) { quantity.dispose(); return; }

    final item = catalog.firstWhere((value) => value['id']?.toString() == supplyItemId);
    try {
      await api.recordProviderJobSupply(
        jobId,
        supplyItemId: supplyItemId,
        quantity: num.parse(quantity.text.trim()),
        unitCode: item['unitCode'].toString(),
        idempotencyKey: 'mobile-supply-${DateTime.now().microsecondsSinceEpoch}',
      );
      await _loadUsage(jobId);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('saved'))));
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } finally {
      quantity.dispose();
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('title')), actions: [
      IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh')),
    ]),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: _jobWritable && catalog.isNotEmpty ? _record : null,
      icon: const Icon(Icons.add),
      label: Text(t('record')),
      backgroundColor: _jobWritable && catalog.isNotEmpty ? widget.accent : Colors.grey,
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : ListView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                children: [
                  if (jobs.isEmpty)
                    _empty(t('noJobs'))
                  else ...[
                    DropdownButtonFormField<String>(
                      initialValue: selectedJobId,
                      decoration: InputDecoration(labelText: t('job'), border: const OutlineInputBorder()),
                      items: jobs.map((job) => DropdownMenuItem(
                        value: job['id']?.toString(),
                        child: Text('${job['sourceType'] ?? ''} · ${job['sourceStatus'] ?? ''} · ${_date(job['scheduledAt'])}'),
                      )).toList(growable: false),
                      onChanged: (value) async {
                        setState(() { selectedJobId = value; usages = const []; });
                        if (value != null) await _loadUsage(value);
                      },
                    ),
                    const SizedBox(height: 10),
                    Text(
                      _jobWritable ? t('activeJob') : t('closedJob'),
                      style: TextStyle(color: _jobWritable ? const Color(0xFF15803D) : const Color(0xFF64748B)),
                    ),
                    const SizedBox(height: 16),
                    Text(t('usage'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 8),
                    if (usages.isEmpty)
                      _empty(t('noUsage'))
                    else
                      ...usages.map((item) => Card(child: ListTile(
                        leading: const Icon(Icons.inventory_2_outlined),
                        title: Text(_label(item['labels'], widget.locale, item['code']?.toString() ?? '')),
                        subtitle: Text('${item['quantity'] ?? ''} ${item['unitCode'] ?? ''} · ${_date(item['recordedAt'])}'),
                      ))),
                  ],
                  if (catalog.isEmpty) Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(t('noCatalog'), style: const TextStyle(color: Color(0xFF64748B))),
                  ),
                ],
              ),
  );

  Widget _empty(String value) => Card(
    child: Padding(padding: const EdgeInsets.all(18), child: Text(value, textAlign: TextAlign.center)),
  );
}

String providerSuppliesText(CarePointLocale locale, String key) {
  const copy = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Service supplies','record':'Record consumption','item':'Supply item','quantity':'Quantity','cancel':'Cancel','save':'Save','saved':'Supply consumption recorded.','refresh':'Refresh','job':'Assigned job','activeJob':'This job can accept supply consumption.','closedJob':'This job is not currently writable. Existing usage remains visible.','usage':'Recorded usage','noJobs':'No assigned field jobs.','noUsage':'No supplies recorded for this job.','noCatalog':'No active supply catalog items are available.','invalidQuantity':'Enter a quantity greater than zero.'
    },
    CarePointLocale.ar: {
      'title':'مستلزمات الخدمة','record':'تسجيل الاستهلاك','item':'المادة','quantity':'الكمية','cancel':'إلغاء','save':'حفظ','saved':'تم تسجيل استهلاك المادة.','refresh':'تحديث','job':'المهمة المعيّنة','activeJob':'يمكن تسجيل استهلاك المواد لهذه المهمة.','closedJob':'لا يمكن تعديل هذه المهمة حالياً. يبقى الاستهلاك السابق ظاهراً.','usage':'الاستهلاك المسجل','noJobs':'لا توجد مهام ميدانية معيّنة.','noUsage':'لم تُسجل مواد لهذه المهمة.','noCatalog':'لا توجد مواد نشطة في الكتالوج.','invalidQuantity':'أدخل كمية أكبر من صفر.'
    },
    CarePointLocale.fr: {
      'title':'Fournitures du service','record':'Enregistrer la consommation','item':'Article','quantity':'Quantité','cancel':'Annuler','save':'Enregistrer','saved':'Consommation enregistrée.','refresh':'Actualiser','job':'Mission assignée','activeJob':'Cette mission accepte la consommation de fournitures.','closedJob':'Cette mission n’est pas modifiable. Les consommations existantes restent visibles.','usage':'Consommations enregistrées','noJobs':'Aucune mission terrain assignée.','noUsage':'Aucune fourniture enregistrée pour cette mission.','noCatalog':'Aucun article actif dans le catalogue.','invalidQuantity':'Saisissez une quantité supérieure à zéro.'
    },
    CarePointLocale.es: {
      'title':'Material del servicio','record':'Registrar consumo','item':'Material','quantity':'Cantidad','cancel':'Cancelar','save':'Guardar','saved':'Consumo de material registrado.','refresh':'Actualizar','job':'Trabajo asignado','activeJob':'Este trabajo permite registrar consumo de material.','closedJob':'Este trabajo no admite cambios ahora. El consumo anterior sigue visible.','usage':'Consumo registrado','noJobs':'No hay trabajos de campo asignados.','noUsage':'No hay material registrado para este trabajo.','noCatalog':'No hay artículos activos en el catálogo.','invalidQuantity':'Introduce una cantidad mayor que cero.'
    },
  };
  return copy[locale]?[key] ?? copy[CarePointLocale.en]![key] ?? key;
}

String _label(dynamic value, CarePointLocale locale, String fallback) {
  final map = _map(value);
  final key = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  final localized = map[key]?.toString().trim() ?? '';
  if (localized.isNotEmpty) return localized;
  final english = map['en']?.toString().trim() ?? '';
  return english.isNotEmpty ? english : fallback;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return const {};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

String _date(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '');
  if (parsed == null) return '—';
  return parsed.toLocal().toString().substring(0, 16);
}
