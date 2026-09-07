import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract interface class CarePointTokenStore {
  Future<String?> readAccessToken();
  Future<String?> readRefreshToken();
  Future<void> writeTokens({required String accessToken, required String refreshToken});
  Future<void> clear();
}

class SecureCarePointTokenStore implements CarePointTokenStore {
  SecureCarePointTokenStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  static const _accessKey = 'carepoint.auth.access_token';
  static const _refreshKey = 'carepoint.auth.refresh_token';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> readAccessToken() => _storage.read(key: _accessKey);

  @override
  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  @override
  Future<void> writeTokens({required String accessToken, required String refreshToken}) async {
    // Refresh tokens are single-use. Persist the rotated refresh token first so a
    // partial platform-storage failure remains recoverable on the next startup.
    await _storage.write(key: _refreshKey, value: refreshToken);
    await _storage.write(key: _accessKey, value: accessToken);
  }

  @override
  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _accessKey),
      _storage.delete(key: _refreshKey),
    ]);
  }
}

class MemoryCarePointTokenStore implements CarePointTokenStore {
  String? accessToken;
  String? refreshToken;

  @override
  Future<String?> readAccessToken() async => accessToken;

  @override
  Future<String?> readRefreshToken() async => refreshToken;

  @override
  Future<void> writeTokens({required String accessToken, required String refreshToken}) async {
    this.refreshToken = refreshToken;
    this.accessToken = accessToken;
  }

  @override
  Future<void> clear() async {
    accessToken = null;
    refreshToken = null;
  }
}
