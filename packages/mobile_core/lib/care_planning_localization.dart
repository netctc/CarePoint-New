import 'carepoint_localization.dart';

String planningText(CarePointLocale locale, String key) {
  final row = planningLabels[key];
  return row?[locale.name] ?? row?['en'] ?? key;
}
const planningLabels = <String, Map<String, String>>{
  'reschedule': {'en':'Reschedule visit','es':'Reprogramar cita','fr':'Reprogrammer la visite','ar':'تغيير موعد الزيارة'},
  'waitlist': {'en':'Earlier-appointment waiting list','es':'Lista de espera para adelantar citas','fr':'Liste d’attente pour avancer les rendez-vous','ar':'قائمة انتظار موعد أقرب'},
  'join': {'en':'Request an earlier appointment','es':'Solicitar una cita más temprana','fr':'Demander un rendez-vous plus tôt','ar':'طلب موعد أقرب'},
  'history': {'en':'Change history','es':'Historial de cambios','fr':'Historique des changements','ar':'سجل التغييرات'},
  'from': {'en':'From date (dd/mm/yyyy)','es':'Desde (dd/mm/aaaa)','fr':'Du (jj/mm/aaaa)','ar':'من تاريخ (يوم/شهر/سنة)'},
  'to': {'en':'Through date (dd/mm/yyyy)','es':'Hasta (dd/mm/aaaa)','fr':'Au (jj/mm/aaaa)','ar':'إلى تاريخ (يوم/شهر/سنة)'},
  'window': {'en':'Choose a date range','es':'Elegir un intervalo de fechas','fr':'Choisir une période','ar':'اختيار فترة زمنية'},
  'invalidWindow': {'en':'Enter valid dates within the permitted range.','es':'Introduce fechas válidas dentro del intervalo permitido.','fr':'Saisissez des dates valides dans la période autorisée.','ar':'أدخل تواريخ صحيحة ضمن الفترة المسموح بها.'},
  'noGuarantee': {'en':'Your current booking stays in place. Refresh to check openings; joining does not reserve a slot or send automatic alerts. You must confirm a new time.','es':'Conservas tu cita actual. Actualiza para consultar huecos; apuntarte no reserva una plaza ni envía avisos automáticos. Debes confirmar el nuevo horario.','fr':'Votre réservation reste active. Actualisez pour vérifier les disponibilités. Aucun créneau réservé ni alerte automatique : vous devez confirmer le nouvel horaire.','ar':'يبقى حجزك الحالي قائماً. حدّث للاطلاع على المواعيد المتاحة. لا يتم حجز وقت أو إرسال تنبيه تلقائياً؛ يجب تأكيد الموعد الجديد.'},
  'preserved': {'en':'Same provider, service and visit details. The existing invoice and payments are retained; this action creates no new charge.','es':'Mismo profesional, servicio y datos de visita. Se conservan la factura y los pagos; esta acción no genera un nuevo cobro.','fr':'Même prestataire, service et détails de visite. La facture et les paiements sont conservés, sans nouveau débit.','ar':'نفس مقدم الخدمة والخدمة وتفاصيل الزيارة. تُحفظ الفاتورة والمدفوعات دون إنشاء دفعة جديدة.'},
  'current': {'en':'Current appointment','es':'Cita actual','fr':'Rendez-vous actuel','ar':'الموعد الحالي'},
  'newTime': {'en':'New appointment time','es':'Nuevo horario','fr':'Nouvel horaire','ar':'الموعد الجديد'},
  'confirm': {'en':'Confirm time change','es':'Confirmar cambio de horario','fr':'Confirmer le changement','ar':'تأكيد تغيير الموعد'},
  'cancel': {'en':'Back','es':'Volver','fr':'Retour','ar':'رجوع'},
  'apply': {'en':'Apply range','es':'Aplicar intervalo','fr':'Appliquer la période','ar':'تطبيق الفترة'},
  'retry': {'en':'Retry','es':'Reintentar','fr':'Réessayer','ar':'إعادة المحاولة'},
  'refresh': {'en':'Refresh availability','es':'Actualizar disponibilidad','fr':'Actualiser les disponibilités','ar':'تحديث المواعيد المتاحة'},
  'changed': {'en':'Appointment time changed.','es':'Horario de la cita actualizado.','fr':'Horaire du rendez-vous modifié.','ar':'تم تغيير موعد الزيارة.'},
  'pending': {'en':'The result is uncertain. Retry this same change before leaving; do not create another booking.','es':'El resultado es incierto. Reintenta este mismo cambio antes de salir; no crees otra reserva.','fr':'Résultat incertain. Réessayez ce même changement avant de quitter, sans créer une autre réservation.','ar':'النتيجة غير مؤكدة. أعد محاولة التغيير نفسه قبل المغادرة ولا تنشئ حجزاً آخر.'},
  'joined': {'en':'Earlier-appointment request saved.','es':'Solicitud de adelanto guardada.','fr':'Demande de rendez-vous anticipé enregistrée.','ar':'تم حفظ طلب الموعد الأقرب.'},
  'matches': {'en':'Check earlier openings','es':'Consultar huecos anteriores','fr':'Vérifier les créneaux antérieurs','ar':'الاطلاع على المواعيد الأقرب'},
  'withdraw': {'en':'Withdraw request','es':'Retirar solicitud','fr':'Retirer la demande','ar':'سحب الطلب'},
  'empty': {'en':'No matching items. Your existing appointment is unchanged.','es':'No hay resultados. Tu cita actual no cambia.','fr':'Aucun résultat. Votre rendez-vous actuel reste inchangé.','ar':'لا توجد نتائج مطابقة. موعدك الحالي لم يتغير.'},
  'more': {'en':'Result limit reached. Use a narrower date range.','es':'Se alcanzó el límite de resultados. Reduce el intervalo.','fr':'Limite de résultats atteinte. Réduisez la période.','ar':'تم بلوغ حد النتائج. اختر فترة أقصر.'},
  'recent': {'en':'The latest 100 records are shown.','es':'Se muestran los 100 registros más recientes.','fr':'Les 100 derniers enregistrements sont affichés.','ar':'يتم عرض آخر 100 سجل.'},
  'demand': {'en':'Waiting demand by service','es':'Demanda en espera por servicio','fr':'Demandes en attente par service','ar':'الطلبات المنتظرة حسب الخدمة'},
  'privacy': {'en':'Aggregated demand only; no patient identities or clinical details are shown.','es':'Solo demanda agrupada; no se muestran identidades ni datos clínicos.','fr':'Demandes agrégées uniquement, sans identité ni détail clinique.','ar':'طلبات مجمعة فقط دون هوية المرضى أو التفاصيل الطبية.'},
  'count': {'en':'Waiting requests','es':'Solicitudes en espera','fr':'Demandes en attente','ar':'الطلبات المنتظرة'},
  'WAITING': {'en':'Waiting','es':'En espera','fr':'En attente','ar':'قيد الانتظار'},
  'WITHDRAWN': {'en':'Withdrawn','es':'Retirada','fr':'Retirée','ar':'تم السحب'},
  'FULFILLED': {'en':'Earlier slot accepted','es':'Adelanto confirmado','fr':'Créneau anticipé confirmé','ar':'تم تأكيد الموعد الأقرب'},
  'CLOSED': {'en':'Closed after appointment change','es':'Cerrada por cambio de cita','fr':'Clôturée après modification','ar':'أُغلق بعد تغيير الموعد'},
  'EXPIRED': {'en':'Requested period ended','es':'Intervalo solicitado finalizado','fr':'Période demandée terminée','ar':'انتهت الفترة المطلوبة'},
};
