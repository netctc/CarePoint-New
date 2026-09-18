import 'carepoint_localization.dart';

const availabilityDemandLabels = <String, Map<String, String>>{
  'title': {'en': 'Availability requests', 'es': 'Solicitudes de disponibilidad', 'fr': 'Demandes de disponibilité', 'ar': 'طلبات المواعيد المتاحة'},
  'policy': {'en': 'Active requests without a matching booking, grouped by your service and modality. Counts are requests, not unique patients. No patient identities are displayed. This view does not reserve times or send alerts.', 'es': 'Solicitudes activas sin una cita coincidente, agrupadas por tu servicio y modalidad. Se cuentan solicitudes, no pacientes únicos. No se muestran identidades de pacientes. Esta vista no reserva horarios ni envía avisos.', 'fr': 'Demandes actives sans rendez-vous correspondant, regroupées par votre service et modalité. Les nombres représentent des demandes, pas des patients uniques. Aucune identité affichée. Cette vue ne réserve aucun créneau et n’envoie aucune alerte.', 'ar': 'طلبات نشطة دون موعد مطابق، مجمعة حسب خدماتك وطريقة تقديمها. الأعداد تمثل الطلبات وليس المرضى الفريدين. لا تظهر هويات المرضى. هذه الشاشة لا تحجز المواعيد ولا ترسل تنبيهات.'},
  'count': {'en': 'Active requests', 'es': 'Solicitudes activas', 'fr': 'Demandes actives', 'ar': 'الطلبات النشطة'},
  'range': {'en': 'Requested date range', 'es': 'Intervalo de fechas solicitado', 'fr': 'Période demandée', 'ar': 'الفترة المطلوبة'},
  'checked': {'en': 'Last refreshed', 'es': 'Última actualización', 'fr': 'Dernière actualisation', 'ar': 'آخر تحديث'},
  'inactive': {'en': 'Service or modality inactive. Review your configuration before offering appointments.', 'es': 'Servicio o modalidad inactivos. Revisa la configuración antes de ofrecer citas.', 'fr': 'Service ou modalité inactifs. Vérifiez la configuration avant de proposer des rendez-vous.', 'ar': 'الخدمة أو طريقة تقديمها غير نشطة. راجع الإعدادات قبل تقديم المواعيد.'},
  'empty': {'en': 'No active availability requests for your services.', 'es': 'No hay solicitudes activas para tus servicios.', 'fr': 'Aucune demande active pour vos services.', 'ar': 'لا توجد طلبات نشطة لخدماتك.'},
  'refresh': {'en': 'Refresh demand', 'es': 'Actualizar demanda', 'fr': 'Actualiser la demande', 'ar': 'تحديث الطلبات'},
  'more': {'en': 'Load more services', 'es': 'Cargar más servicios', 'fr': 'Charger plus de services', 'ar': 'تحميل المزيد من الخدمات'},
  'limit': {'en': 'The display limit has been reached. Some service groups are not shown.', 'es': 'Se ha alcanzado el límite de visualización. Algunos grupos de servicios no se muestran.', 'fr': 'La limite d’affichage est atteinte. Certains groupes de services ne sont pas affichés.', 'ar': 'تم الوصول إلى حد العرض. بعض مجموعات الخدمات غير معروضة.'},
};
String availabilityDemandText(CarePointLocale locale, String key) => availabilityDemandLabels[key]?[locale.name] ?? availabilityDemandLabels[key]?['en'] ?? key;
