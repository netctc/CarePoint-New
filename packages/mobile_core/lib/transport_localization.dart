import 'carepoint_localization.dart';

const _transportCopy = <CarePointLocale, Map<String, String>>{
  CarePointLocale.en: {
    'title': 'Medical transport', 'scheduled': 'Scheduled transport', 'schedule': 'Schedule transport', 'history': 'My transport requests',
    'ground': 'Ground', 'air': 'Air', 'mode': 'Transport mode', 'pickup': 'Pickup', 'destination': 'Destination', 'address': 'Address',
    'latitude': 'Latitude', 'longitude': 'Longitude', 'scheduledFor': 'Scheduled for', 'assistance': 'Assistance', 'standard': 'Standard',
    'wheelchair': 'Wheelchair', 'stretcher': 'Stretcher', 'request': 'Request transport', 'cancel': 'Cancel request', 'status': 'Status', 'eta': 'ETA',
    'emergency': 'Emergency ambulance', 'emergencyConfirm': 'Request an emergency ambulance to your current location?',
    'emergencyWarning': 'Use this only for urgent medical transport. It bypasses normal booking and sends your current location to dispatch.',
    'requestEmergency': 'REQUEST AMBULANCE NOW', 'locating': 'Getting your location…', 'locationDenied': 'Location permission is required to dispatch an ambulance.',
    'emergencyRequested': 'Emergency ambulance requested', 'refresh': 'Refresh status', 'providerTitle': 'Transport operations',
    'available': 'Available requests', 'assigned': 'Assigned jobs', 'accept': 'Accept job', 'notTransportProvider': 'Transport operations are not enabled for this provider category.',
    'advance': 'Advance status', 'noRequests': 'No transport requests yet.', 'noJobs': 'No transport jobs right now.', 'minutes': 'min',
  },
  CarePointLocale.ar: {
    'title': 'النقل الطبي', 'scheduled': 'نقل طبي مجدول', 'schedule': 'جدولة النقل', 'history': 'طلبات النقل الخاصة بي',
    'ground': 'بري', 'air': 'جوي', 'mode': 'نوع النقل', 'pickup': 'موقع الانطلاق', 'destination': 'الوجهة', 'address': 'العنوان',
    'latitude': 'خط العرض', 'longitude': 'خط الطول', 'scheduledFor': 'موعد النقل', 'assistance': 'المساعدة', 'standard': 'عادية',
    'wheelchair': 'كرسي متحرك', 'stretcher': 'نقالة', 'request': 'طلب النقل', 'cancel': 'إلغاء الطلب', 'status': 'الحالة', 'eta': 'الوقت المتوقع',
    'emergency': 'إسعاف طارئ', 'emergencyConfirm': 'هل تريد طلب سيارة إسعاف طارئة إلى موقعك الحالي؟',
    'emergencyWarning': 'استخدم هذا الخيار للنقل الطبي العاجل فقط. يتجاوز الحجز العادي ويرسل موقعك الحالي إلى مركز التوجيه.',
    'requestEmergency': 'اطلب الإسعاف الآن', 'locating': 'جارٍ تحديد موقعك…', 'locationDenied': 'يلزم السماح بالموقع لإرسال سيارة الإسعاف.',
    'emergencyRequested': 'تم طلب سيارة الإسعاف', 'refresh': 'تحديث الحالة', 'providerTitle': 'عمليات النقل',
    'available': 'الطلبات المتاحة', 'assigned': 'المهام المسندة', 'accept': 'قبول المهمة', 'notTransportProvider': 'عمليات النقل غير مفعلة لهذه الفئة من مقدمي الخدمة.',
    'advance': 'تحديث المرحلة', 'noRequests': 'لا توجد طلبات نقل بعد.', 'noJobs': 'لا توجد مهام نقل حالياً.', 'minutes': 'دقيقة',
  },
  CarePointLocale.fr: {
    'title': 'Transport médical', 'scheduled': 'Transport programmé', 'schedule': 'Programmer un transport', 'history': 'Mes demandes de transport',
    'ground': 'Terrestre', 'air': 'Aérien', 'mode': 'Mode de transport', 'pickup': 'Départ', 'destination': 'Destination', 'address': 'Adresse',
    'latitude': 'Latitude', 'longitude': 'Longitude', 'scheduledFor': 'Prévu pour', 'assistance': 'Assistance', 'standard': 'Standard',
    'wheelchair': 'Fauteuil roulant', 'stretcher': 'Brancard', 'request': 'Demander le transport', 'cancel': 'Annuler la demande', 'status': 'Statut', 'eta': 'Arrivée estimée',
    'emergency': 'Ambulance d’urgence', 'emergencyConfirm': 'Demander une ambulance d’urgence à votre position actuelle ?',
    'emergencyWarning': 'À utiliser uniquement pour un transport médical urgent. Ce flux contourne la réservation normale et transmet votre position au dispatch.',
    'requestEmergency': 'DEMANDER UNE AMBULANCE', 'locating': 'Localisation en cours…', 'locationDenied': 'L’autorisation de localisation est nécessaire pour envoyer une ambulance.',
    'emergencyRequested': 'Ambulance d’urgence demandée', 'refresh': 'Actualiser le statut', 'providerTitle': 'Opérations de transport',
    'available': 'Demandes disponibles', 'assigned': 'Missions attribuées', 'accept': 'Accepter la mission', 'notTransportProvider': 'Les opérations de transport ne sont pas activées pour cette catégorie de prestataire.',
    'advance': 'Avancer le statut', 'noRequests': 'Aucune demande de transport.', 'noJobs': 'Aucune mission de transport actuellement.', 'minutes': 'min',
  },
  CarePointLocale.es: {
    'title': 'Transporte médico', 'scheduled': 'Transporte programado', 'schedule': 'Programar transporte', 'history': 'Mis solicitudes de transporte',
    'ground': 'Terrestre', 'air': 'Aéreo', 'mode': 'Modo de transporte', 'pickup': 'Recogida', 'destination': 'Destino', 'address': 'Dirección',
    'latitude': 'Latitud', 'longitude': 'Longitud', 'scheduledFor': 'Programado para', 'assistance': 'Asistencia', 'standard': 'Estándar',
    'wheelchair': 'Silla de ruedas', 'stretcher': 'Camilla', 'request': 'Solicitar transporte', 'cancel': 'Cancelar solicitud', 'status': 'Estado', 'eta': 'Tiempo estimado',
    'emergency': 'Ambulancia de emergencia', 'emergencyConfirm': '¿Solicitar una ambulancia de emergencia a tu ubicación actual?',
    'emergencyWarning': 'Úsalo solo para transporte médico urgente. Omite la reserva normal y envía tu ubicación actual al centro de despacho.',
    'requestEmergency': 'SOLICITAR AMBULANCIA', 'locating': 'Obteniendo ubicación…', 'locationDenied': 'Se requiere permiso de ubicación para enviar una ambulancia.',
    'emergencyRequested': 'Ambulancia de emergencia solicitada', 'refresh': 'Actualizar estado', 'providerTitle': 'Operaciones de transporte',
    'available': 'Solicitudes disponibles', 'assigned': 'Servicios asignados', 'accept': 'Aceptar servicio', 'notTransportProvider': 'Las operaciones de transporte no están habilitadas para esta categoría de proveedor.',
    'advance': 'Avanzar estado', 'noRequests': 'Todavía no hay solicitudes de transporte.', 'noJobs': 'No hay servicios de transporte ahora.', 'minutes': 'min',
  },
};

String transportText(CarePointLocale locale, String key) => _transportCopy[locale]?[key] ?? _transportCopy[CarePointLocale.en]?[key] ?? key;
