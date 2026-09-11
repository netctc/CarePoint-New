import 'carepoint_localization.dart';

const _patientMessages = <CarePointLocale, Map<String, String>>{
  CarePointLocale.en: {
    'new': 'new',
    'messageCareTeam': 'Message care team',
    'appointmentConversation': 'Secure appointment conversation',
    'noConversation': 'No secure conversation exists for this appointment yet.',
    'startConversation': 'Start secure conversation',
    'notEligible': 'Secure messaging is available for confirmed or completed appointments.',
    'contextHint': 'This conversation is linked to this CarePoint appointment and its care team.',
    'loadFailed': 'Unable to load secure messages. Try again.',
  },
  CarePointLocale.ar: {
    'new': 'جديد',
    'messageCareTeam': 'مراسلة فريق الرعاية',
    'appointmentConversation': 'محادثة الموعد الآمنة',
    'noConversation': 'لا توجد محادثة آمنة لهذا الموعد حتى الآن.',
    'startConversation': 'بدء محادثة آمنة',
    'notEligible': 'المراسلة الآمنة متاحة للمواعيد المؤكدة أو المكتملة.',
    'contextHint': 'هذه المحادثة مرتبطة بموعد CarePoint هذا وفريق الرعاية الخاص به.',
    'loadFailed': 'تعذر تحميل الرسائل الآمنة. حاول مرة أخرى.',
  },
  CarePointLocale.fr: {
    'new': 'nouveau',
    'messageCareTeam': 'Contacter l’équipe de soins',
    'appointmentConversation': 'Conversation sécurisée du rendez-vous',
    'noConversation': 'Aucune conversation sécurisée n’existe encore pour ce rendez-vous.',
    'startConversation': 'Démarrer une conversation sécurisée',
    'notEligible': 'La messagerie sécurisée est disponible pour les rendez-vous confirmés ou terminés.',
    'contextHint': 'Cette conversation est liée à ce rendez-vous CarePoint et à son équipe de soins.',
    'loadFailed': 'Impossible de charger les messages sécurisés. Réessayez.',
  },
  CarePointLocale.es: {
    'new': 'nuevo',
    'messageCareTeam': 'Mensaje al equipo asistencial',
    'appointmentConversation': 'Conversación segura de la cita',
    'noConversation': 'Todavía no existe una conversación segura para esta cita.',
    'startConversation': 'Iniciar conversación segura',
    'notEligible': 'La mensajería segura está disponible para citas confirmadas o completadas.',
    'contextHint': 'Esta conversación está vinculada a esta cita de CarePoint y a su equipo asistencial.',
    'loadFailed': 'No se pudieron cargar los mensajes seguros. Inténtalo de nuevo.',
  },
};

String patientMessagesText(CarePointLocale locale, String key) =>
    _patientMessages[locale]?[key] ?? _patientMessages[CarePointLocale.en]?[key] ?? key;
