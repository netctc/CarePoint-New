import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'clinical_localization.dart';
import 'patient_document_centre.dart';

String patientEncounterDetailText(CarePointLocale locale, String key) =>
    _patientEncounterMessages[locale]?[key] ??
    _patientEncounterMessages[CarePointLocale.en]![key] ??
    key;

const Map<CarePointLocale, Map<String, String>> _patientEncounterMessages = {
  CarePointLocale.en: {
    'title': 'Visit detail',
    'viewFull': 'View full visit detail',
    'readOnly': 'Read-only clinical encounter',
    'forbidden': 'This page is available only to patient accounts.',
    'missingId': 'The visit identifier is missing.',
    'mismatch': 'The clinical response did not match the requested visit.',
    'noRecord': 'No clinical record is available for this visit yet.',
    'visit': 'Visit',
    'date': 'Date',
    'provider': 'Provider',
    'service': 'Service',
    'status': 'Status',
    'modality': 'Modality',
    'accessBasis': 'Access basis',
    'revision': 'Revision',
    'finalized': 'Finalized',
    'yes': 'Yes',
    'no': 'No',
    'vitals': 'Vital signs',
    'temperatureC': 'Temperature (°C)',
    'heartRateBpm': 'Heart rate (bpm)',
    'systolicMmHg': 'Systolic BP (mmHg)',
    'diastolicMmHg': 'Diastolic BP (mmHg)',
    'respiratoryRate': 'Respiratory rate',
    'oxygenSaturationPct': 'Oxygen saturation (%)',
    'weightKg': 'Weight (kg)',
    'heightCm': 'Height (cm)',
    'diagnoses': 'Diagnoses',
    'treatments': 'Treatments',
    'medications': 'Medications',
    'attachments': 'Clinical attachments',
    'dose': 'Dose',
    'route': 'Route',
    'frequency': 'Frequency',
    'duration': 'Duration',
    'code': 'Code',
    'openDocument': 'Open securely',
  },
  CarePointLocale.ar: {
    'title': 'تفاصيل الزيارة',
    'viewFull': 'عرض تفاصيل الزيارة كاملة',
    'readOnly': 'سجل سريري للقراءة فقط',
    'forbidden': 'هذه الصفحة متاحة فقط لحسابات المرضى.',
    'missingId': 'معرّف الزيارة غير متوفر.',
    'mismatch': 'الاستجابة السريرية لا تطابق الزيارة المطلوبة.',
    'noRecord': 'لا يوجد سجل سريري متاح لهذه الزيارة بعد.',
    'visit': 'الزيارة',
    'date': 'التاريخ',
    'provider': 'مقدم الرعاية',
    'service': 'الخدمة',
    'status': 'الحالة',
    'modality': 'نمط الزيارة',
    'accessBasis': 'أساس الصلاحية',
    'revision': 'النسخة',
    'finalized': 'مغلق',
    'yes': 'نعم',
    'no': 'لا',
    'vitals': 'العلامات الحيوية',
    'temperatureC': 'الحرارة (°م)',
    'heartRateBpm': 'معدل القلب',
    'systolicMmHg': 'الضغط الانقباضي',
    'diastolicMmHg': 'الضغط الانبساطي',
    'respiratoryRate': 'معدل التنفس',
    'oxygenSaturationPct': 'تشبع الأكسجين (%)',
    'weightKg': 'الوزن (كغ)',
    'heightCm': 'الطول (سم)',
    'diagnoses': 'التشخيصات',
    'treatments': 'العلاجات',
    'medications': 'الأدوية',
    'attachments': 'المرفقات السريرية',
    'dose': 'الجرعة',
    'route': 'طريقة الاستخدام',
    'frequency': 'التكرار',
    'duration': 'المدة',
    'code': 'الرمز',
    'openDocument': 'فتح آمن',
  },
  CarePointLocale.fr: {
    'title': 'Détail de la visite',
    'viewFull': 'Voir le détail complet de la visite',
    'readOnly': 'Consultation clinique en lecture seule',
    'forbidden': 'Cette page est réservée aux comptes patients.',
    'missingId': 'L’identifiant de la visite est manquant.',
    'mismatch': 'La réponse clinique ne correspond pas à la visite demandée.',
    'noRecord': 'Aucun dossier clinique n’est encore disponible pour cette visite.',
    'visit': 'Visite',
    'date': 'Date',
    'provider': 'Prestataire',
    'service': 'Service',
    'status': 'Statut',
    'modality': 'Modalité',
    'accessBasis': 'Base d’accès',
    'revision': 'Version',
    'finalized': 'Finalisée',
    'yes': 'Oui',
    'no': 'Non',
    'vitals': 'Signes vitaux',
    'temperatureC': 'Température (°C)',
    'heartRateBpm': 'Fréquence cardiaque',
    'systolicMmHg': 'TA systolique',
    'diastolicMmHg': 'TA diastolique',
    'respiratoryRate': 'Fréquence respiratoire',
    'oxygenSaturationPct': 'Saturation en oxygène (%)',
    'weightKg': 'Poids (kg)',
    'heightCm': 'Taille (cm)',
    'diagnoses': 'Diagnostics',
    'treatments': 'Traitements',
    'medications': 'Médicaments',
    'attachments': 'Pièces jointes cliniques',
    'dose': 'Dose',
    'route': 'Voie',
    'frequency': 'Fréquence',
    'duration': 'Durée',
    'code': 'Code',
    'openDocument': 'Ouvrir en sécurité',
  },
  CarePointLocale.es: {
    'title': 'Detalle de la visita',
    'viewFull': 'Ver detalle completo de la visita',
    'readOnly': 'Encuentro clínico de solo lectura',
    'forbidden': 'Esta página está disponible solo para cuentas de pacientes.',
    'missingId': 'Falta el identificador de la visita.',
    'mismatch': 'La respuesta clínica no corresponde a la visita solicitada.',
    'noRecord': 'Todavía no hay un registro clínico disponible para esta visita.',
    'visit': 'Visita',
    'date': 'Fecha',
    'provider': 'Profesional',
    'service': 'Servicio',
    'status': 'Estado',
    'modality': 'Modalidad',
    'accessBasis': 'Base de acceso',
    'revision': 'Revisión',
    'finalized': 'Finalizada',
    'yes': 'Sí',
    'no': 'No',
    'vitals': 'Signos vitales',
    'temperatureC': 'Temperatura (°C)',
    'heartRateBpm': 'Frecuencia cardiaca',
    'systolicMmHg': 'Tensión sistólica',
    'diastolicMmHg': 'Tensión diastólica',
    'respiratoryRate': 'Frecuencia respiratoria',
    'oxygenSaturationPct': 'Saturación de oxígeno (%)',
    'weightKg': 'Peso (kg)',
    'heightCm': 'Altura (cm)',
    'diagnoses': 'Diagnósticos',
    'treatments': 'Tratamientos',
    'medications': 'Medicamentos',
    'attachments': 'Adjuntos clínicos',
    'dose': 'Dosis',
    'route': 'Vía',
    'frequency': 'Frecuencia',
    'duration': 'Duración',
    'code': 'Código',
    'openDocument': 'Abrir de forma segura',
  },
};

class PatientEncounterDetailPage extends StatefulWidget {
  const PatientEncounterDetailPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointmentId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String appointmentId;

  @override
  State<PatientEncounterDetailPage> createState() =>
      _PatientEncounterDetailPageState();
}

class _PatientEncounterDetailPageState
    extends State<PatientEncounterDetailPage> {
  bool busy = true;
  String? error;
  Map<String, dynamic>? encounter;

  bool get _isPatient => widget.session.role.toUpperCase() == 'PATIENT';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!_isPatient) {
      if (mounted) {
        setState(() {
          busy = false;
          error = null;
          encounter = null;
        });
      }
      return;
    }

    final appointmentId = widget.appointmentId.trim();
    if (appointmentId.isEmpty) {
      if (mounted) {
        setState(() {
          busy = false;
          error = patientEncounterDetailText(widget.locale, 'missingId');
          encounter = null;
        });
      }
      return;
    }

    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.session.api.clinicalEncounter(appointmentId);
      final appointment = _map(result['appointment']);
      if (appointment['id']?.toString() != appointmentId) {
        throw CarePointApiException(
          patientEncounterDetailText(widget.locale, 'mismatch'),
        );
      }
      if (!mounted) return;
      setState(() => encounter = result);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        key: const ValueKey('patient-encounter-detail'),
        appBar: AppBar(
          title: Text(patientEncounterDetailText(widget.locale, 'title')),
        ),
        body: !_isPatient
            ? _message(patientEncounterDetailText(widget.locale, 'forbidden'))
            : busy
                ? const Center(child: CircularProgressIndicator())
                : error != null
                    ? _errorState()
                    : _encounterBody(),
      ),
    );
  }

  Widget _errorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('patient-encounter-retry'),
              onPressed: _load,
              child: Text(cpText(widget.locale, 'common.retry')),
            ),
          ],
        ),
      ),
    );
  }

  Widget _encounterBody() {
    final value = encounter ?? const <String, dynamic>{};
    final appointment = _map(value['appointment']);
    final provider = _map(appointment['provider']);
    final service = _map(appointment['service']);
    final record = _map(value['latestRecord']);
    final data = _map(record['data']);
    final vitals = _map(data['vitals']);
    final diagnoses = _list(data['diagnoses']);
    final treatments = _stringList(data['treatments']);
    final medications = _list(data['medications']);
    final attachments = _list(data['attachments']);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              const Icon(Icons.lock_outline, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  patientEncounterDetailText(widget.locale, 'readOnly'),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _heading(patientEncounterDetailText(widget.locale, 'visit')),
                  _field(
                    patientEncounterDetailText(widget.locale, 'date'),
                    _date(appointment['startsAt']),
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'provider'),
                    provider['displayName'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'service'),
                    service['name'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'status'),
                    appointment['status'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'modality'),
                    appointment['modality'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'accessBasis'),
                    value['accessBasis'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'revision'),
                    record['revision'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'finalized'),
                    value['finalized'] == true
                        ? patientEncounterDetailText(widget.locale, 'yes')
                        : patientEncounterDetailText(widget.locale, 'no'),
                  ),
                ],
              ),
            ),
          ),
          if (record.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Text(
                patientEncounterDetailText(widget.locale, 'noRecord'),
                textAlign: TextAlign.center,
              ),
            )
          else ...[
            _textCard(
              clinicalText(widget.locale, 'chiefComplaint'),
              data['chiefComplaint'],
            ),
            _textCard(
              clinicalText(widget.locale, 'subjective'),
              data['subjective'],
            ),
            _textCard(
              clinicalText(widget.locale, 'objective'),
              data['objective'],
            ),
            _textCard(
              clinicalText(widget.locale, 'assessment'),
              data['assessment'],
            ),
            _textCard(
              clinicalText(widget.locale, 'plan'),
              data['plan'],
            ),
            if (vitals.isNotEmpty) _vitalsCard(vitals),
            if (diagnoses.isNotEmpty) _diagnosesCard(diagnoses),
            if (treatments.isNotEmpty) _treatmentsCard(treatments),
            if (medications.isNotEmpty) _medicationsCard(medications),
            if (attachments.isNotEmpty) _attachmentsCard(attachments),
          ],
        ],
      ),
    );
  }

  Widget _vitalsCard(Map<String, dynamic> vitals) {
    return _card(
      patientEncounterDetailText(widget.locale, 'vitals'),
      vitals.entries
          .where((entry) => entry.value != null)
          .map(
            (entry) => _field(
              patientEncounterDetailText(widget.locale, entry.key),
              entry.value,
            ),
          )
          .toList(growable: false),
    );
  }

  Widget _diagnosesCard(List<Map<String, dynamic>> diagnoses) {
    return _card(
      patientEncounterDetailText(widget.locale, 'diagnoses'),
      diagnoses
          .map(
            (diagnosis) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    diagnosis['display']?.toString() ?? '—',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  if (diagnosis['code'] != null)
                    Text(
                      '${patientEncounterDetailText(widget.locale, 'code')}: ${diagnosis['code']}',
                    ),
                  if (diagnosis['status'] != null)
                    Text(
                      '${patientEncounterDetailText(widget.locale, 'status')}: ${diagnosis['status']}',
                    ),
                ],
              ),
            ),
          )
          .toList(growable: false),
    );
  }

  Widget _treatmentsCard(List<String> treatments) {
    return _card(
      patientEncounterDetailText(widget.locale, 'treatments'),
      treatments
          .map(
            (treatment) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('• $treatment'),
            ),
          )
          .toList(growable: false),
    );
  }

  Widget _medicationsCard(List<Map<String, dynamic>> medications) {
    return _card(
      patientEncounterDetailText(widget.locale, 'medications'),
      medications
          .map(
            (medication) => Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    medication['name']?.toString() ?? '—',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'dose'),
                    medication['dose'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'route'),
                    medication['route'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'frequency'),
                    medication['frequency'],
                  ),
                  _field(
                    patientEncounterDetailText(widget.locale, 'duration'),
                    medication['duration'],
                  ),
                ],
              ),
            ),
          )
          .toList(growable: false),
    );
  }

  Widget _attachmentsCard(List<Map<String, dynamic>> attachments) {
    return _card(
      patientEncounterDetailText(widget.locale, 'attachments'),
      attachments.map((attachment) {
        final documentId = attachment['documentId']?.toString().trim() ?? '';
        final name = attachment['name']?.toString().trim();
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                name == null || name.isEmpty ? '—' : name,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              if (attachment['kind'] != null)
                Text(attachment['kind'].toString()),
              if (attachment['mimeType'] != null)
                Text(attachment['mimeType'].toString()),
              if (documentId.isNotEmpty)
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: OutlinedButton.icon(
                    key: ValueKey('patient-encounter-document-$documentId'),
                    onPressed: () => Navigator.push<void>(
                      context,
                      MaterialPageRoute(
                        builder: (_) => Directionality(
                          textDirection: widget.locale.textDirection,
                          child: PatientDocumentCentrePage(
                            session: widget.session,
                            locale: widget.locale,
                            focusDocumentId: documentId,
                          ),
                        ),
                      ),
                    ),
                    icon: const Icon(Icons.folder_open_outlined),
                    label: Text(
                      patientEncounterDetailText(
                        widget.locale,
                        'openDocument',
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      }).toList(growable: false),
    );
  }

  Widget _textCard(String label, dynamic value) {
    final text = value?.toString().trim() ?? '';
    if (text.isEmpty) return const SizedBox.shrink();
    return _card(label, [Text(text)]);
  }

  Widget _card(String title, List<Widget> children) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _heading(title),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _heading(String value) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(
          value,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
      );

  Widget _field(String label, dynamic value) {
    final text = value?.toString().trim() ?? '';
    if (text.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text('$label: $text'),
    );
  }

  Widget _message(String value) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(value, textAlign: TextAlign.center),
        ),
      );
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

List<String> _stringList(dynamic value) {
  if (value is! List) return const [];
  return value
      .map((item) => item?.toString().trim() ?? '')
      .where((item) => item.isNotEmpty)
      .toList(growable: false);
}

String _date(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  return '${parsed.day.toString().padLeft(2, '0')}/${parsed.month.toString().padLeft(2, '0')}/${parsed.year.toString().padLeft(4, '0')}';
}
