// 거래처 폴더 API 클라이언트 — HQ 가 패널 폴더 API 를 직접 호출한다(Rust FFI/codegen 없이).
//   기존 FFI(chainremoteGetApiBase/GetToken)로 URL·Bearer 토큰만 얻고 나머지는 dart http.
//   즐겨찾기는 Rust 를 거치지만, 폴더는 조작 빈도가 낮아 Flutter 직접 호출로 충분(가볍다).

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_hbb/models/platform_model.dart'; // bind

class Folder {
  final String id;
  final String name;
  Folder(this.id, this.name);
}

class ChainRemoteFolderApi {
  static String get _base => bind.chainremoteGetApiBase();
  static Map<String, String> get _headers => {
        'authorization': 'Bearer ${bind.chainremoteGetToken()}',
        'content-type': 'application/json',
      };

  /// 내 대리점 폴더 목록. 실패하면 빈 목록(호출 측이 조용히 처리).
  static Future<List<Folder>> list() async {
    try {
      final res = await http
          .get(Uri.parse('$_base/api/folders'), headers: _headers)
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) return [];
      final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      final rows = (data['folders'] as List?) ?? [];
      return rows
          .map((e) => Folder(e['id'] as String, e['name'] as String))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// 폴더 생성(findOrCreate). 성공 시 Folder, 실패 시 null.
  static Future<Folder?> create(String name) async {
    try {
      final res = await http
          .post(Uri.parse('$_base/api/folders'),
              headers: _headers, body: jsonEncode({'name': name}))
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 201) return null;
      final f = (jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>)['folder'];
      return Folder(f['id'] as String, f['name'] as String);
    } catch (_) {
      return null;
    }
  }

  /// 거래처(remoteId)를 폴더에 배정. folderId=null 이면 폴더에서 빼기.
  static Future<bool> assign(String remoteId, String? folderId) async {
    try {
      final res = await http
          .post(Uri.parse('$_base/api/customers/folder'),
              headers: _headers,
              body: jsonEncode({'remoteId': remoteId, 'folderId': folderId ?? ''}))
          .timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// 폴더 삭제(소속 거래처는 폴더만 풀림).
  static Future<bool> delete(String folderId) async {
    try {
      final res = await http
          .delete(Uri.parse('$_base/api/folders/$folderId'), headers: _headers)
          .timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// 폴더 이름 변경. 'ok' / 'dup'(같은 대리점에 그 이름 이미 있음) / 'fail'.
  static Future<String> rename(String folderId, String newName) async {
    try {
      final res = await http
          .patch(Uri.parse('$_base/api/folders/$folderId'),
              headers: _headers, body: jsonEncode({'name': newName}))
          .timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) return 'ok';
      if (res.statusCode == 409) return 'dup';
      return 'fail';
    } catch (_) {
      return 'fail';
    }
  }
}
