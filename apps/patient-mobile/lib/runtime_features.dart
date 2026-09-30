const bool transportModuleEnabled = bool.fromEnvironment(
  'TRANSPORT_MODULE_ENABLED',
  defaultValue: false,
);


const String transportMapTileUrl = String.fromEnvironment(
  'TRANSPORT_MAP_TILE_URL',
  defaultValue: '',
);

const String transportMapAttribution = String.fromEnvironment(
  'TRANSPORT_MAP_ATTRIBUTION',
  defaultValue: '',
);

bool get transportMapPickerEnabled => transportMapTileUrl.trim().isNotEmpty;
