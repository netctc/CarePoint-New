import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientEmergencyCardPage extends StatefulWidget {
  const PatientEmergencyCardPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientEmergencyCardPage> createState() => _PatientEmergencyCardPageState();
}

class _PatientEmergencyCardPageState extends State<PatientEmergencyCardPage> {
  bool loading = true;
  String? error;
  Map<String, dynamic> card = const {};
  Map<String, dynamic> settings = const {};

  String t(String key) => patientEmergencyCardText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        widget.session.api.patientEmergencyCard(),
        widget.session.api.patientEmergencyCardSettings(),
      ]);
      if (!mounted) return;
      setState(() {
        card = values[0];
        settings = values[1];
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _configure() async {
    final pref = _map(settings['preference']);
    final contacts = _maps(settings['contacts']);
    bool allergies = pref['includeSevereAllergies'] == true;
    bool medications = pref['includeActiveMedications'] == true;
    bool conditions = pref['includeActiveConditions'] == true;
    String? contactId = pref['emergencyContactId']?.toString();

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setLocal) => AlertDialog(
        title: Text(t('settings')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: Text(t('privacyHint'), style: const TextStyle(color: Color(0xFF64748B))),
          ),
          SwitchListTile(
            value: allergies,
            title: Text(t('severeAllergies')),
            onChanged: (value) => setLocal(() => allergies = value),
          ),
          SwitchListTile(
            value: medications,
            title: Text(t('activeMedications')),
            onChanged: (value) => setLocal(() => medications = value),
          ),
          SwitchListTile(
            value: conditions,
            title: Text(t('activeConditions')),
            onChanged: (value) => setLocal(() => conditions = value),
          ),
          DropdownButtonFormField<String>(
            initialValue: contactId,
            decoration: InputDecoration(labelText: t('emergencyContact')),
            items: [
              DropdownMenuItem<String>(value: null, child: Text(t('noContact'))),
              ...contacts.map((item) => DropdownMenuItem(
                value: item['id']?.toString(),
                child: Text('${item['displayName'] ?? ''} · ${item['relationship'] ?? ''}'),
              )),
            ],
            onChanged: (value) => setLocal(() => contactId = value),
          ),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('save'))),
        ],
      )),
    );
    if (accepted != true) return;

    try {
      await widget.session.api.updatePatientEmergencyCardSettings(
        expectedVersion: _int(pref['version'], 0),
        includeSevereAllergies: allergies,
        includeActiveMedications: medications,
        includeActiveConditions: conditions,
        emergencyContactId: contactId,
      );
      await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('title')),
      actions: [
        IconButton(key: const ValueKey('patient-emergency-card-settings'), onPressed: _configure, icon: const Icon(Icons.tune_outlined), tooltip: t('settings')),
        IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh')),
      ],
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Row(children: [
                          const Icon(Icons.emergency_outlined),
                          const SizedBox(width: 8),
                          Expanded(child: Text(t('title'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900))),
                        ]),
                        const SizedBox(height: 8),
                        Text(t('patientControlled'), style: const TextStyle(color: Color(0xFF64748B))),
                        const SizedBox(height: 4),
                        Text('${t('updated')}: ${_dateTime(card['updatedAt'])}'),
                      ]),
                    )),
                    const SizedBox(height: 12),
                    _clinicalSection(
                      t('severeAllergies'),
                      _maps(_map(card['sections'])['severeAllergies']),
                      Icons.warning_amber_outlined,
                      (item) => '${item['substance'] ?? '—'}${item['reaction'] == null ? '' : ' · ${item['reaction']}'}',
                    ),
                    _clinicalSection(
                      t('activeMedications'),
                      _maps(_map(card['sections'])['activeMedications']),
                      Icons.medication_outlined,
                      (item) => [item['name'], item['dose'], item['frequency']].where((v) => v != null && v.toString().isNotEmpty).join(' · '),
                    ),
                    _clinicalSection(
                      t('activeConditions'),
                      _maps(_map(card['sections'])['activeConditions']),
                      Icons.monitor_heart_outlined,
                      (item) => item['display']?.toString() ?? '—',
                    ),
                    _contactCard(_map(_map(card['sections'])['emergencyContact'])),
                    const SizedBox(height: 12),
                    Text(t('noDocuments'), textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF64748B))),
                  ],
                ),
              ),
  );

  Widget _clinicalSection(
    String title,
    List<Map<String, dynamic>> items,
    IconData icon,
    String Function(Map<String, dynamic>) label,
  ) => Card(child: Padding(
    padding: const EdgeInsets.all(14),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [Icon(icon), const SizedBox(width: 8), Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w900)))]),
      const SizedBox(height: 8),
      if (items.isEmpty)
        Text(t('notShared'), style: const TextStyle(color: Color(0xFF64748B)))
      else
        ...items.map((item) => ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          title: Text(label(item)),
          subtitle: Text('${t('source')}: ${item['sourceType'] ?? '—'} · ${item['verificationStatus'] ?? '—'}'),
        )),
    ]),
  ));

  Widget _contactCard(Map<String, dynamic> contact) => Card(child: Padding(
    padding: const EdgeInsets.all(14),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [const Icon(Icons.contact_phone_outlined), const SizedBox(width: 8), Expanded(child: Text(t('emergencyContact'), style: const TextStyle(fontWeight: FontWeight.w900)))]),
      const SizedBox(height: 8),
      if (contact.isEmpty)
        Text(t('notShared'), style: const TextStyle(color: Color(0xFF64748B)))
      else ...[
        Text(contact['displayName']?.toString() ?? '—', style: const TextStyle(fontWeight: FontWeight.w800)),
        Text('${contact['relationship'] ?? ''} · ${contact['phone'] ?? ''}'),
      ],
    ]),
  ));

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return '—';
    String two(int number) => number.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
  }
}

String patientEmergencyCardText(CarePointLocale locale, String key) {
  const copy = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Emergency medical card','settings':'Card settings','refresh':'Refresh','privacyHint':'Nothing is shared by default. Choose only the minimum information you want on this card.',
      'severeAllergies':'Severe allergies','activeMedications':'Active medications','activeConditions':'Active conditions','emergencyContact':'Emergency contact','noContact':'No contact on card',
      'save':'Save','cancel':'Cancel','updated':'Updated','patientControlled':'Patient-controlled minimum emergency information.','notShared':'Not included on this card.',
      'noDocuments':'This card never includes full clinical documents.','source':'Source'
    },
    CarePointLocale.ar: {
      'title':'بطاقة الطوارئ الطبية','settings':'إعدادات البطاقة','refresh':'تحديث','privacyHint':'لا تتم مشاركة أي شيء افتراضياً. اختر فقط الحد الأدنى من المعلومات التي تريدها في البطاقة.',
      'severeAllergies':'الحساسيات الشديدة','activeMedications':'الأدوية النشطة','activeConditions':'الحالات النشطة','emergencyContact':'جهة اتصال للطوارئ','noContact':'لا توجد جهة اتصال في البطاقة',
      'save':'حفظ','cancel':'إلغاء','updated':'آخر تحديث','patientControlled':'حد أدنى من معلومات الطوارئ يتحكم به المريض.','notShared':'غير مضمّن في هذه البطاقة.',
      'noDocuments':'لا تتضمن هذه البطاقة أبداً مستندات سريرية كاملة.','source':'المصدر'
    },
    CarePointLocale.fr: {
      'title':'Carte médicale d’urgence','settings':'Paramètres de la carte','refresh':'Actualiser','privacyHint':'Rien n’est partagé par défaut. Choisissez uniquement les informations minimales à afficher.',
      'severeAllergies':'Allergies sévères','activeMedications':'Médicaments actifs','activeConditions':'Affections actives','emergencyContact':'Contact d’urgence','noContact':'Aucun contact sur la carte',
      'save':'Enregistrer','cancel':'Annuler','updated':'Mise à jour','patientControlled':'Informations d’urgence minimales contrôlées par le patient.','notShared':'Non inclus sur cette carte.',
      'noDocuments':'Cette carte n’inclut jamais de documents cliniques complets.','source':'Source'
    },
    CarePointLocale.es: {
      'title':'Tarjeta médica de emergencia','settings':'Configuración de la tarjeta','refresh':'Actualizar','privacyHint':'Por defecto no se comparte nada. Elige sólo la información mínima que deseas incluir.',
      'severeAllergies':'Alergias graves','activeMedications':'Medicación activa','activeConditions':'Condiciones activas','emergencyContact':'Contacto de emergencia','noContact':'Sin contacto en la tarjeta',
      'save':'Guardar','cancel':'Cancelar','updated':'Actualizada','patientControlled':'Información mínima de emergencia controlada por el paciente.','notShared':'No incluido en esta tarjeta.',
      'noDocuments':'Esta tarjeta nunca incluye documentos clínicos completos.','source':'Origen'
    },
  };
  return copy[locale]?[key] ?? copy[CarePointLocale.en]![key] ?? key;
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
int _int(dynamic value, int fallback) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? fallback;
