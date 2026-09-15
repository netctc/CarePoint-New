import 'carepoint_localization.dart';

const _communications = <CarePointLocale, Map<String, String>>{
  CarePointLocale.en: {
    'title': 'Messages & notifications', 'messages': 'Secure messages', 'notifications': 'Notifications', 'preferences': 'Notification preferences',
    'newConversation': 'New conversation', 'appointmentId': 'Appointment ID', 'subject': 'Subject', 'initialMessage': 'Initial message', 'create': 'Create conversation',
    'noConversations': 'No secure conversations yet.', 'noMessages': 'No messages yet.', 'messageHint': 'Write a secure message', 'send': 'Send', 'close': 'Close conversation',
    'closed': 'Closed', 'open': 'Open', 'unread': 'unread', 'careTeam': 'Care team', 'providerId': 'Provider ID', 'addProvider': 'Add provider',
    'privacy': 'Message content stays inside the secure CarePoint channel. External notifications contain no clinical message text.',
    'noNotifications': 'No notifications yet.', 'markRead': 'Mark read', 'inApp': 'In-app', 'push': 'Push', 'email': 'Email', 'sms': 'SMS', 'save': 'Save preferences',
    'endpoint': 'Push endpoint reference', 'registerPush': 'Register push endpoint', 'endpointStored': 'Endpoint stored as an opaque provider reference.', 'refresh': 'Refresh',
    'selectAppointmentHint': 'Use a confirmed or completed CarePoint appointment.', 'careTeamHint': 'Adding a provider requires a treatment relationship or patient-specific consent.',
  },
  CarePointLocale.ar: {
    'title': 'الرسائل والإشعارات', 'messages': 'رسائل آمنة', 'notifications': 'الإشعارات', 'preferences': 'تفضيلات الإشعارات',
    'newConversation': 'محادثة جديدة', 'appointmentId': 'معرّف الموعد', 'subject': 'الموضوع', 'initialMessage': 'الرسالة الأولى', 'create': 'إنشاء المحادثة',
    'noConversations': 'لا توجد محادثات آمنة بعد.', 'noMessages': 'لا توجد رسائل بعد.', 'messageHint': 'اكتب رسالة آمنة', 'send': 'إرسال', 'close': 'إغلاق المحادثة',
    'closed': 'مغلقة', 'open': 'مفتوحة', 'unread': 'غير مقروء', 'careTeam': 'فريق الرعاية', 'providerId': 'معرّف مقدم الرعاية', 'addProvider': 'إضافة مقدم رعاية',
    'privacy': 'يبقى محتوى الرسائل داخل قناة CarePoint الآمنة. لا تحتوي الإشعارات الخارجية على نصوص سريرية.',
    'noNotifications': 'لا توجد إشعارات بعد.', 'markRead': 'تحديد كمقروء', 'inApp': 'داخل التطبيق', 'push': 'إشعار فوري', 'email': 'البريد الإلكتروني', 'sms': 'رسالة SMS', 'save': 'حفظ التفضيلات',
    'endpoint': 'مرجع نقطة الإشعار', 'registerPush': 'تسجيل نقطة إشعار فوري', 'endpointStored': 'يتم حفظ نقطة الإشعار كمرجع خارجي مبهم.', 'refresh': 'تحديث',
    'selectAppointmentHint': 'استخدم موعد CarePoint مؤكداً أو مكتملاً.', 'careTeamHint': 'تتطلب إضافة مقدم رعاية علاقة علاجية أو موافقة خاصة من المريض.',
  },
  CarePointLocale.fr: {
    'title': 'Messages et notifications', 'messages': 'Messages sécurisés', 'notifications': 'Notifications', 'preferences': 'Préférences de notification',
    'newConversation': 'Nouvelle conversation', 'appointmentId': 'ID du rendez-vous', 'subject': 'Objet', 'initialMessage': 'Message initial', 'create': 'Créer la conversation',
    'noConversations': 'Aucune conversation sécurisée.', 'noMessages': 'Aucun message.', 'messageHint': 'Écrire un message sécurisé', 'send': 'Envoyer', 'close': 'Fermer la conversation',
    'closed': 'Fermée', 'open': 'Ouverte', 'unread': 'non lus', 'careTeam': 'Équipe de soins', 'providerId': 'ID du prestataire', 'addProvider': 'Ajouter le prestataire',
    'privacy': 'Le contenu reste dans le canal CarePoint sécurisé. Les notifications externes ne contiennent aucun texte clinique.',
    'noNotifications': 'Aucune notification.', 'markRead': 'Marquer comme lue', 'inApp': 'Dans l’application', 'push': 'Push', 'email': 'E-mail', 'sms': 'SMS', 'save': 'Enregistrer',
    'endpoint': 'Référence du terminal push', 'registerPush': 'Enregistrer le terminal push', 'endpointStored': 'Le terminal est stocké comme référence opaque du fournisseur.', 'refresh': 'Actualiser',
    'selectAppointmentHint': 'Utilisez un rendez-vous CarePoint confirmé ou terminé.', 'careTeamHint': 'Ajouter un prestataire exige une relation de soins ou un consentement spécifique du patient.',
  },
  CarePointLocale.es: {
    'title': 'Mensajes y notificaciones', 'messages': 'Mensajes seguros', 'notifications': 'Notificaciones', 'preferences': 'Preferencias de notificación',
    'newConversation': 'Nueva conversación', 'appointmentId': 'ID de la cita', 'subject': 'Asunto', 'initialMessage': 'Mensaje inicial', 'create': 'Crear conversación',
    'noConversations': 'Todavía no hay conversaciones seguras.', 'noMessages': 'Todavía no hay mensajes.', 'messageHint': 'Escribe un mensaje seguro', 'send': 'Enviar', 'close': 'Cerrar conversación',
    'closed': 'Cerrada', 'open': 'Abierta', 'unread': 'sin leer', 'careTeam': 'Equipo asistencial', 'providerId': 'ID del proveedor', 'addProvider': 'Añadir proveedor',
    'privacy': 'El contenido permanece dentro del canal seguro de CarePoint. Las notificaciones externas no contienen texto clínico.',
    'noNotifications': 'Todavía no hay notificaciones.', 'markRead': 'Marcar como leída', 'inApp': 'En la app', 'push': 'Push', 'email': 'Correo', 'sms': 'SMS', 'save': 'Guardar preferencias',
    'endpoint': 'Referencia del endpoint push', 'registerPush': 'Registrar endpoint push', 'endpointStored': 'El endpoint se guarda como referencia opaca del proveedor.', 'refresh': 'Actualizar',
    'selectAppointmentHint': 'Usa una cita CarePoint confirmada o completada.', 'careTeamHint': 'Añadir un proveedor requiere relación terapéutica o consentimiento específico del paciente.',
  },
};

String communicationsText(CarePointLocale locale, String key) => _communications[locale]?[key] ?? _communications[CarePointLocale.en]?[key] ?? key;
