import 'package:flutter/material.dart';

import 'availability_centre.dart';
import 'care_visits.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'communications_workspace.dart';
import 'patient_clinical_order.dart';
import 'patient_diagnostic_report.dart';
import 'patient_emergency.dart';
import 'patient_medical_transport.dart';

const patientNotificationRoutableEntityTypes = <String>{
  'APPOINTMENT',
  'AVAILABILITY_REQUEST',
  'CARE_CONVERSATION',
  'CLINICAL_ORDER',
  'DIAGNOSTIC_REPORT',
  'EMERGENCY_AMBULANCE_REQUEST',
  'MEDICAL_TRANSPORT_REQUEST',
};

enum PatientNotificationDestination { appointment, availability, conversation, clinicalOrder, diagnosticReport, emergency, transport, generic }

PatientNotificationDestination patientNotificationDestination(Map<String, dynamic> row) => switch (row['entityType']?.toString()) {
      'APPOINTMENT' => PatientNotificationDestination.appointment,
      'AVAILABILITY_REQUEST' => PatientNotificationDestination.availability,
      'CARE_CONVERSATION' => PatientNotificationDestination.conversation,
      'CLINICAL_ORDER' => PatientNotificationDestination.clinicalOrder,
      'DIAGNOSTIC_REPORT' => PatientNotificationDestination.diagnosticReport,
      'EMERGENCY_AMBULANCE_REQUEST' => PatientNotificationDestination.emergency,
      'MEDICAL_TRANSPORT_REQUEST' => PatientNotificationDestination.transport,
      _ => PatientNotificationDestination.generic,
    };

String patientNotificationText(CarePointLocale locale, String key) =>
    _patientNotificationLabels[locale.name]?[key] ?? _patientNotificationLabels['en']?[key] ?? key;

String patientNotificationTitle(CarePointLocale locale, Map<String, dynamic> row) {
  final key = row['safeTitleKey']?.toString() ?? '';
  final semantic = _safeTitleKeys[key];
  if (semantic != null) return patientNotificationText(locale, semantic);
  final type = row['type']?.toString() ?? '';
  return patientNotificationText(locale, switch (type) {
    'APPOINTMENT_UPDATE' => 'appointmentUpdate',
    'SECURE_MESSAGE' => 'secureMessage',
    'CLINICAL_UPDATE' => 'clinicalUpdate',
    'INSURANCE_UPDATE' => 'insuranceUpdate',
    'CARE_COORDINATION' => 'careCoordination',
    'EMERGENCY_UPDATE' => 'emergencyUpdate',
    'TRANSPORT_UPDATE' => 'transportUpdate',
    _ => 'generic',
  });
}

const _safeTitleKeys = <String, String>{
  'notification.appointment.requested.title': 'appointmentRequested',
  'notification.appointment.confirmed.title': 'appointmentConfirmed',
  'notification.appointment.cancelled.title': 'appointmentCancelled',
  'notification.appointment.completed.title': 'appointmentCompleted',
  'notification.appointment.no-show.title': 'appointmentNoShow',
  'notification.appointment.rescheduled.title': 'appointmentRescheduled',
  'notification.appointment.reminder.title': 'appointmentReminder',
  'notification.availability.available.title': 'availabilityFound',
  'notification.message.title': 'secureMessage',
  'notification.care.title': 'careCoordination',
  'notification.clinical.lab-result.title': 'labResultReady',
  'notification.clinical.diagnostic-report.title': 'diagnosticReportReady',
  'notification.emergency.title': 'emergencyUpdate',
  'notification.transport.title': 'transportUpdate',
};

class PatientNotificationCentreEntryButton extends StatefulWidget {
  const PatientNotificationCentreEntryButton({super.key, required this.session, required this.locale});

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientNotificationCentreEntryButton> createState() => _PatientNotificationCentreEntryButtonState();
}

class _PatientNotificationCentreEntryButtonState extends State<PatientNotificationCentreEntryButton> {
  bool loading = true;
  bool opening = false;
  int unread = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PatientNotificationCentreEntryButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session != widget.session) _load();
  }

  Future<void> _load() async {
    if (widget.session.account['role'] != 'PATIENT') {
      if (mounted) setState(() { loading = false; unread = 0; });
      return;
    }
    try {
      final rows = await widget.session.api.notifications().timeout(const Duration(seconds: 30));
      if (mounted) setState(() { unread = rows.where((row) => row['readAt'] == null).length; loading = false; });
    } catch (_) {
      if (mounted) setState(() { unread = 0; loading = false; });
    }
  }

  Future<void> _open() async {
    if (opening || widget.session.account['role'] != 'PATIENT') return;
    setState(() => opening = true);
    try {
      await Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => PatientNotificationCentrePage(session: widget.session, locale: widget.locale)),
      );
    } finally {
      if (mounted) {
        setState(() => opening = false);
        await _load();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.session.account['role'] != 'PATIENT') return const SizedBox.shrink();
    final label = unread == 0
        ? patientNotificationText(widget.locale, 'centre')
        : '${patientNotificationText(widget.locale, 'centre')} · $unread ${patientNotificationText(widget.locale, 'unread')}';
    return FilledButton.tonalIcon(
      key: const ValueKey('patient-notification-centre-entry'),
      onPressed: opening ? null : _open,
      icon: loading || opening
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
          : Icon(unread > 0 ? Icons.notifications_active_outlined : Icons.notifications_none),
      label: Text(label),
    );
  }
}

class PatientNotificationCentrePage extends StatefulWidget {
  const PatientNotificationCentrePage({super.key, required this.session, required this.locale});

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientNotificationCentrePage> createState() => _PatientNotificationCentrePageState();
}

class _PatientNotificationCentrePageState extends State<PatientNotificationCentrePage> {
  List<Map<String, dynamic>> items = const [];
  String view = 'unread';
  bool loading = true;
  final mutating = <String>{};
  String? error;

  String t(String key) => patientNotificationText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    if (widget.session.account['role'] == 'PATIENT') {
      load();
    } else {
      loading = false;
      error = t('denied');
    }
  }

  Future<void> load() async {
    if (widget.session.account['role'] != 'PATIENT') return;
    setState(() { loading = true; error = null; });
    try {
      final rows = await widget.session.api.notifications().timeout(const Duration(seconds: 30));
      if (!mounted) return;
      setState(() => items = rows);
    } catch (_) {
      if (mounted) setState(() => error = t('loadFailed'));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> openEvent(Map<String, dynamic> row) async {
    final id = row['id']?.toString() ?? '';
    if (id.isEmpty || mutating.contains(id)) return;
    setState(() => mutating.add(id));
    try {
      if (row['readAt'] == null) {
        try {
          final updated = await widget.session.api.markNotificationRead(id).timeout(const Duration(seconds: 30));
          if (mounted) {
            setState(() {
              items = items.map((item) => item['id'] == id ? {...item, 'readAt': updated['readAt'] ?? DateTime.now().toUtc().toIso8601String()} : item).toList(growable: false);
            });
          }
        } catch (_) {
          // Acknowledgement failure must not grant or remove access to the
          // underlying entity. Every routed destination re-authorizes itself.
        }
      }
      if (!mounted) return;
      final entityId = row['entityId']?.toString() ?? '';
      if (entityId.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('noDetail'))));
        return;
      }
      switch (patientNotificationDestination(row)) {
        case PatientNotificationDestination.appointment:
          await Navigator.push<void>(
            context,
            MaterialPageRoute(builder: (_) => Directionality(
              textDirection: widget.locale.textDirection,
              child: Scaffold(
                appBar: AppBar(title: Text(t('appointmentDetails'))),
                body: CareVisitsPage(session: widget.session, locale: widget.locale, focusAppointmentId: entityId),
              ),
            )),
          );
          break;
        case PatientNotificationDestination.availability:
          await Navigator.push<void>(
            context,
            MaterialPageRoute(builder: (_) => CareAvailabilityCentrePage(
              session: widget.session,
              locale: widget.locale,
              focusRequestId: entityId,
            )),
          );
          break;
        case PatientNotificationDestination.conversation:
          await Navigator.push<void>(
            context,
            MaterialPageRoute(builder: (_) => Directionality(
              textDirection: widget.locale.textDirection,
              child: CareConversationPage(
                session: widget.session,
                locale: widget.locale,
                accent: Theme.of(context).colorScheme.primary,
                conversationId: entityId,
                isProvider: false,
              ),
            )),
          );
          break;
        case PatientNotificationDestination.clinicalOrder:
          await Navigator.push<void>(
            context,
            MaterialPageRoute(builder: (_) => PatientClinicalOrderResultPage(
              session: widget.session,
              locale: widget.locale,
              orderId: entityId,
            )),
          );
          break;
        case PatientNotificationDestination.diagnosticReport:
          await Navigator.push<void>(
            context,
            MaterialPageRoute(builder: (_) => PatientDiagnosticReportPage(
              session: widget.session,
              locale: widget.locale,
              reportId: entityId,
            )),
          );
          break;
        case PatientNotificationDestination.emergency:
          await Navigator.push<void>(
            context,
            MaterialPageRoute(builder: (_) => PatientEmergencyStatusPage(
              session: widget.session,
              locale: widget.locale,
              requestId: entityId,
            )),
          );
          break;
        case PatientNotificationDestination.transport:
          await Navigator.push<void>(
            context,
            MaterialPageRoute(builder: (_) => PatientMedicalTransportStatusPage(
              session: widget.session,
              locale: widget.locale,
              requestId: entityId,
            )),
          );
          break;
        case PatientNotificationDestination.generic:
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('noDetail'))));
          break;
      }
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('openFailed'))));
    } finally {
      if (mounted) {
        setState(() => mutating.remove(id));
        await load();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.session.account['role'] != 'PATIENT') {
      return Directionality(
        textDirection: widget.locale.textDirection,
        child: Scaffold(appBar: AppBar(title: Text(t('centre'))), body: Center(child: Text(t('denied')))),
      );
    }
    final visible = items.where((row) => view == 'all' || row['readAt'] == null).toList(growable: false);
    final unreadCount = items.where((row) => row['readAt'] == null).length;
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        appBar: AppBar(title: Text(t('centre'))),
        body: RefreshIndicator(
          onRefresh: load,
          child: ListView(
            padding: const EdgeInsets.all(16),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Text(t('hint'), style: const TextStyle(color: Color(0xFF64748B))),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: [
                  ButtonSegment(value: 'unread', label: Text('${t('unreadView')} ($unreadCount)')),
                  ButtonSegment(value: 'all', label: Text(t('allView'))),
                ],
                selected: {view},
                onSelectionChanged: (value) => setState(() => view = value.first),
              ),
              if (error != null) ...[
                const SizedBox(height: 12),
                Semantics(liveRegion: true, child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                TextButton.icon(onPressed: load, icon: const Icon(Icons.refresh), label: Text(t('retry'))),
              ],
              if (loading) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
              if (!loading && error == null && visible.isEmpty)
                Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(view == 'unread' ? t('noUnread') : t('empty')))),
              for (final row in visible) _notificationCard(row),
            ],
          ),
        ),
      ),
    );
  }

  Widget _notificationCard(Map<String, dynamic> row) {
    final id = row['id']?.toString() ?? '';
    final unread = row['readAt'] == null;
    final destination = patientNotificationDestination(row);
    final routable = destination != PatientNotificationDestination.generic && (row['entityId']?.toString().isNotEmpty ?? false);
    return Card(
      key: ValueKey('notification-$id'),
      child: ListTile(
        leading: Icon(_icon(row, destination)),
        title: Text(patientNotificationTitle(widget.locale, row), style: TextStyle(fontWeight: unread ? FontWeight.w800 : FontWeight.w600)),
        subtitle: Text('${_dateTime(row['createdAt'])}\n${unread ? t('unreadState') : t('readState')} · ${routable ? t('openSecurely') : t('genericOnly')}'),
        isThreeLine: true,
        trailing: mutating.contains(id)
            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : Icon(routable ? Icons.chevron_right : (unread ? Icons.mark_email_unread_outlined : Icons.drafts_outlined)),
        onTap: id.isEmpty || mutating.contains(id) ? null : () => openEvent(row),
      ),
    );
  }

  IconData _icon(Map<String, dynamic> row, PatientNotificationDestination destination) => switch (destination) {
    PatientNotificationDestination.appointment => Icons.event_outlined,
    PatientNotificationDestination.availability => Icons.event_available,
    PatientNotificationDestination.conversation => Icons.forum_outlined,
    PatientNotificationDestination.clinicalOrder => Icons.health_and_safety_outlined,
    PatientNotificationDestination.diagnosticReport => Icons.description_outlined,
    PatientNotificationDestination.emergency => Icons.emergency_share_outlined,
    PatientNotificationDestination.transport => Icons.local_shipping_outlined,
    PatientNotificationDestination.generic => switch (row['type']?.toString()) {
      'CLINICAL_UPDATE' => Icons.health_and_safety_outlined,
      'INSURANCE_UPDATE' => Icons.shield_outlined,
      'EMERGENCY_UPDATE' => Icons.warning_amber_outlined,
      'TRANSPORT_UPDATE' => Icons.local_shipping_outlined,
      _ => Icons.notifications_none,
    },
  };

  String _dateTime(dynamic raw) {
    final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (value == null) return t('unknownTime');
    final date = '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}/${value.year.toString().padLeft(4, '0')}';
    final time = '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
    return '$date $time';
  }
}

const Map<String, Map<String, String>> _patientNotificationLabels = {
  'en': {
    'centre': 'Notifications', 'hint': 'Review CarePoint alerts in one place. Sensitive details open only through the authorized CarePoint screen.',
    'unread': 'unread', 'unreadView': 'Unread', 'allView': 'All', 'unreadState': 'Unread', 'readState': 'Read',
    'openSecurely': 'Open securely', 'genericOnly': 'Notification only', 'noDetail': 'No secure detail view is mapped for this notification.',
    'openFailed': 'The notification detail is not available. Refresh and try again.', 'loadFailed': 'Unable to load notifications.',
    'retry': 'Retry', 'noUnread': 'No unread notifications.', 'empty': 'No notifications yet.', 'denied': 'Notifications are available only to the Patient app.',
    'unknownTime': 'Unknown time', 'appointmentDetails': 'Appointment notification', 'generic': 'CarePoint notification',
    'appointmentUpdate': 'Appointment update', 'appointmentRequested': 'Appointment requested', 'appointmentConfirmed': 'Appointment confirmed',
    'appointmentCancelled': 'Appointment cancelled', 'appointmentCompleted': 'Appointment completed', 'appointmentNoShow': 'Appointment status update',
    'appointmentRescheduled': 'Appointment rescheduled', 'appointmentReminder': 'Appointment reminder', 'availabilityFound': 'New appointment time available',
    'secureMessage': 'New secure message', 'careCoordination': 'Care coordination update', 'clinicalUpdate': 'Clinical update', 'labResultReady': 'Laboratory result ready',
    'diagnosticReportReady': 'Diagnostic report ready', 'insuranceUpdate': 'Insurance update', 'emergencyUpdate': 'Emergency update', 'transportUpdate': 'Medical transport update',
  },
  'ar': {
    'centre': 'الإشعارات', 'hint': 'راجع إشعارات CarePoint في مكان واحد. تُفتح التفاصيل الحساسة فقط من خلال شاشة CarePoint المصرح بها.',
    'unread': 'غير مقروء', 'unreadView': 'غير المقروء', 'allView': 'الكل', 'unreadState': 'غير مقروء', 'readState': 'مقروء',
    'openSecurely': 'فتح آمن', 'genericOnly': 'إشعار فقط', 'noDetail': 'لا توجد شاشة تفاصيل آمنة مرتبطة بهذا الإشعار.',
    'openFailed': 'تفاصيل الإشعار غير متاحة. حدّث وحاول مرة أخرى.', 'loadFailed': 'تعذر تحميل الإشعارات.',
    'retry': 'إعادة المحاولة', 'noUnread': 'لا توجد إشعارات غير مقروءة.', 'empty': 'لا توجد إشعارات بعد.', 'denied': 'الإشعارات متاحة فقط في تطبيق المريض.',
    'unknownTime': 'وقت غير معروف', 'appointmentDetails': 'إشعار الموعد', 'generic': 'إشعار CarePoint',
    'appointmentUpdate': 'تحديث الموعد', 'appointmentRequested': 'تم طلب الموعد', 'appointmentConfirmed': 'تم تأكيد الموعد',
    'appointmentCancelled': 'تم إلغاء الموعد', 'appointmentCompleted': 'اكتمل الموعد', 'appointmentNoShow': 'تحديث حالة الموعد',
    'appointmentRescheduled': 'تم تغيير موعد الزيارة', 'appointmentReminder': 'تذكير بالموعد', 'availabilityFound': 'موعد جديد متاح',
    'secureMessage': 'رسالة آمنة جديدة', 'careCoordination': 'تحديث تنسيق الرعاية', 'clinicalUpdate': 'تحديث سريري', 'labResultReady': 'نتيجة المختبر جاهزة',
    'diagnosticReportReady': 'التقرير التشخيصي جاهز', 'insuranceUpdate': 'تحديث التأمين', 'emergencyUpdate': 'تحديث الطوارئ', 'transportUpdate': 'تحديث النقل الطبي',
  },
  'fr': {
    'centre': 'Notifications', 'hint': 'Consultez les alertes CarePoint au même endroit. Les détails sensibles s’ouvrent uniquement dans l’écran CarePoint autorisé.',
    'unread': 'non lues', 'unreadView': 'Non lues', 'allView': 'Toutes', 'unreadState': 'Non lue', 'readState': 'Lue',
    'openSecurely': 'Ouvrir en sécurité', 'genericOnly': 'Notification uniquement', 'noDetail': 'Aucune vue sécurisée n’est associée à cette notification.',
    'openFailed': 'Le détail n’est pas disponible. Actualisez et réessayez.', 'loadFailed': 'Impossible de charger les notifications.',
    'retry': 'Réessayer', 'noUnread': 'Aucune notification non lue.', 'empty': 'Aucune notification.', 'denied': 'Les notifications sont réservées à l’application Patient.',
    'unknownTime': 'Heure inconnue', 'appointmentDetails': 'Notification de rendez-vous', 'generic': 'Notification CarePoint',
    'appointmentUpdate': 'Mise à jour du rendez-vous', 'appointmentRequested': 'Rendez-vous demandé', 'appointmentConfirmed': 'Rendez-vous confirmé',
    'appointmentCancelled': 'Rendez-vous annulé', 'appointmentCompleted': 'Rendez-vous terminé', 'appointmentNoShow': 'Mise à jour du rendez-vous',
    'appointmentRescheduled': 'Rendez-vous reprogrammé', 'appointmentReminder': 'Rappel de rendez-vous', 'availabilityFound': 'Nouveau créneau disponible',
    'secureMessage': 'Nouveau message sécurisé', 'careCoordination': 'Mise à jour de coordination des soins', 'clinicalUpdate': 'Mise à jour clinique', 'labResultReady': 'Résultat de laboratoire disponible',
    'diagnosticReportReady': 'Rapport diagnostique disponible', 'insuranceUpdate': 'Mise à jour assurance', 'emergencyUpdate': 'Mise à jour urgence', 'transportUpdate': 'Mise à jour transport médical',
  },
  'es': {
    'centre': 'Notificaciones', 'hint': 'Revisa los avisos de CarePoint en un único lugar. Los detalles sensibles solo se abren desde la pantalla autorizada de CarePoint.',
    'unread': 'sin leer', 'unreadView': 'Sin leer', 'allView': 'Todas', 'unreadState': 'Sin leer', 'readState': 'Leída',
    'openSecurely': 'Abrir de forma segura', 'genericOnly': 'Solo notificación', 'noDetail': 'No hay una vista de detalle segura asociada a esta notificación.',
    'openFailed': 'El detalle de la notificación no está disponible. Actualiza e inténtalo de nuevo.', 'loadFailed': 'No se pudieron cargar las notificaciones.',
    'retry': 'Reintentar', 'noUnread': 'No hay notificaciones sin leer.', 'empty': 'Todavía no hay notificaciones.', 'denied': 'Las notificaciones solo están disponibles en la aplicación del paciente.',
    'unknownTime': 'Hora desconocida', 'appointmentDetails': 'Notificación de cita', 'generic': 'Notificación de CarePoint',
    'appointmentUpdate': 'Actualización de cita', 'appointmentRequested': 'Cita solicitada', 'appointmentConfirmed': 'Cita confirmada',
    'appointmentCancelled': 'Cita cancelada', 'appointmentCompleted': 'Cita completada', 'appointmentNoShow': 'Actualización del estado de la cita',
    'appointmentRescheduled': 'Cita reprogramada', 'appointmentReminder': 'Recordatorio de cita', 'availabilityFound': 'Nuevo horario de cita disponible',
    'secureMessage': 'Nuevo mensaje seguro', 'careCoordination': 'Actualización de coordinación asistencial', 'clinicalUpdate': 'Actualización clínica', 'labResultReady': 'Resultado de laboratorio disponible',
    'diagnosticReportReady': 'Informe diagnóstico disponible', 'insuranceUpdate': 'Actualización de seguro', 'emergencyUpdate': 'Actualización de emergencia', 'transportUpdate': 'Actualización de transporte médico',
  },
};
