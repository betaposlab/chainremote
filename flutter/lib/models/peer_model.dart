import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'platform_model.dart';
// ignore: depend_on_referenced_packages
import 'package:collection/collection.dart';

class Peer {
  final String id;
  String hash; // personal ab hash password
  String password; // shared ab password
  String username; // pc username
  String hostname;
  String platform;
  String alias;
  List<dynamic> tags;
  bool forceAlwaysRelay = false;
  String rdpPort;
  String rdpUsername;
  bool online = false;
  String loginName; //login username
  String device_group_name;
  String note;
  bool? sameServer;
  // 자가등록 상태. 'active'|'pending'|''(미상). '전체 거래처' 탭에서 pending 표시(별칭
  // 마커는 Rust 쪽)와 마스터 확정 버튼을 보일지 정하는 데 쓴다.
  String enrollStatus;
  // 프로세스 arch. 'x86'|'x64'|''. 내부 진단용(어느 페이로드).
  String arch;
  // OS 표시. os='Windows 7/10/11', osBits='x64'/'x86'(네이티브 OS 비트수). '전체 거래처'
  //   카드에 "Win7 · 64비트" 배지로. arch(페이로드)와 달라 OS 기준이 정확(64비트 Win7 구분).
  String os;
  String osBits;
  // 예약원격 창(마이그048) — 열려 있는 창의 종료 시각(ISO). 빈 문자열이면 닫힘.
  //   우클릭 메뉴가 [예약원격]/[예약원격 취소] 중 무엇을 낼지 여기서 갈린다.
  //   ★하트비트로 올라온 값이라 최대 10분 늦다 — 방금 건 예약은 로컬 기억이 먼저 안다.
  String schedOpenUntil;
  // 취소 요청을 이미 큐에 넣었나(ISO). 값이 있으면 "취소 요청함"으로 보여준다.
  String schedCloseRequestedAt;
  // 디스크 관제(마이그024) — bytes 문자열('' = 미보고). 카드 배지는 위험/주의만 표시.
  String diskTotal;
  String diskFree;
  String tempBytes;
  // 관제 설정·상태(마이그028/036) — 패널이 준 현재 값. 이게 없으면 우클릭 다이얼로그가
  //   켜기/끄기 버튼만 나란히 놓고 "골라라"가 되어, 지금 어느 쪽인지 알 수 없다(2026-08-10 Chang).
  //   firewallControl·vanGaveUp: 'Y'|'' · vanWatch: VAN 종류('ksnet'|'') · vanOk: 'Y'|'N'|''(미보고)
  //   vanGaveUp='Y' 는 자동 복구를 포기한 상태 = 사람이 가야 한다는 뜻이라 목록 위 스트립으로 띄운다.
  String firewallControl;
  String vanWatch;
  String vanOk;
  String vanGaveUp;
  String vanMissing;

  String getId() {
    if (alias != '') {
      return alias;
    }
    return id;
  }

  Peer.fromJson(Map<String, dynamic> json)
      : id = json['id'] ?? '',
        hash = json['hash'] ?? '',
        password = json['password'] ?? '',
        username = json['username'] ?? '',
        hostname = json['hostname'] ?? '',
        platform = json['platform'] ?? '',
        alias = json['alias'] ?? '',
        tags = json['tags'] ?? [],
        forceAlwaysRelay = json['forceAlwaysRelay'] == 'true',
        rdpPort = json['rdpPort'] ?? '',
        rdpUsername = json['rdpUsername'] ?? '',
        loginName = json['loginName'] ?? '',
        device_group_name = json['device_group_name'] ?? '',
        note = json['note'] is String ? json['note'] : '',
        sameServer = json['same_server'],
        enrollStatus = json['enrollStatus'] ?? '',
        arch = json['arch'] ?? '',
        os = json['os'] ?? '',
        osBits = json['osBits'] ?? '',
        schedOpenUntil = json['schedOpenUntil'] ?? '',
        schedCloseRequestedAt = json['schedCloseRequestedAt'] ?? '',
        diskTotal = json['diskTotal'] ?? '',
        diskFree = json['diskFree'] ?? '',
        tempBytes = json['tempBytes'] ?? '',
        firewallControl = json['firewallControl'] ?? '',
        vanWatch = json['vanWatch'] ?? '',
        vanOk = json['vanOk'] ?? '',
        vanGaveUp = json['vanGaveUp'] ?? '',
        vanMissing = json['vanMissing'] ?? '';

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      "id": id,
      "hash": hash,
      "password": password,
      "username": username,
      "hostname": hostname,
      "platform": platform,
      "alias": alias,
      "tags": tags,
      "forceAlwaysRelay": forceAlwaysRelay.toString(),
      "rdpPort": rdpPort,
      "rdpUsername": rdpUsername,
      'loginName': loginName,
      'device_group_name': device_group_name,
      'note': note,
      'same_server': sameServer,
      'enrollStatus': enrollStatus,
      'arch': arch,
      'os': os,
      'osBits': osBits,
      'schedOpenUntil': schedOpenUntil,
      'schedCloseRequestedAt': schedCloseRequestedAt,
      'diskTotal': diskTotal,
      'diskFree': diskFree,
      'tempBytes': tempBytes,
      'firewallControl': firewallControl,
      'vanWatch': vanWatch,
      'vanOk': vanOk,
      'vanGaveUp': vanGaveUp,
      'vanMissing': vanMissing,
    };
  }

  Map<String, dynamic> toCustomJson({required bool includingHash}) {
    var res = <String, dynamic>{
      "id": id,
      "username": username,
      "hostname": hostname,
      "platform": platform,
      "alias": alias,
      "tags": tags,
    };
    if (includingHash) {
      res['hash'] = hash;
    }
    return res;
  }

  Map<String, dynamic> toGroupCacheJson() {
    return <String, dynamic>{
      "id": id,
      "username": username,
      "hostname": hostname,
      "platform": platform,
      "login_name": loginName,
      "device_group_name": device_group_name,
    };
  }

  Peer({
    required this.id,
    required this.hash,
    required this.password,
    required this.username,
    required this.hostname,
    required this.platform,
    required this.alias,
    required this.tags,
    required this.forceAlwaysRelay,
    required this.rdpPort,
    required this.rdpUsername,
    required this.loginName,
    required this.device_group_name,
    required this.note,
    this.sameServer,
    this.enrollStatus = '',
    this.arch = '',
    this.os = '',
    this.osBits = '',
    this.schedOpenUntil = '',
    this.schedCloseRequestedAt = '',
    this.diskTotal = '',
    this.diskFree = '',
    this.tempBytes = '',
    this.firewallControl = '',
    this.vanWatch = '',
    this.vanOk = '',
    this.vanGaveUp = '',
    this.vanMissing = '',
  });

  Peer.loading()
      : this(
          id: '...',
          hash: '',
          password: '',
          username: '...',
          hostname: '...',
          platform: '...',
          alias: '',
          tags: [],
          forceAlwaysRelay: false,
          rdpPort: '',
          rdpUsername: '',
          loginName: '',
          device_group_name: '',
          note: '',
        );
  bool equal(Peer other) {
    return id == other.id &&
        hash == other.hash &&
        password == other.password &&
        username == other.username &&
        hostname == other.hostname &&
        platform == other.platform &&
        alias == other.alias &&
        tags.equals(other.tags) &&
        forceAlwaysRelay == other.forceAlwaysRelay &&
        rdpPort == other.rdpPort &&
        rdpUsername == other.rdpUsername &&
        device_group_name == other.device_group_name &&
        loginName == other.loginName &&
        note == other.note &&
        enrollStatus == other.enrollStatus &&
        arch == other.arch &&
        os == other.os &&
        osBits == other.osBits &&
        diskTotal == other.diskTotal &&
        diskFree == other.diskFree &&
        tempBytes == other.tempBytes;
  }

  Peer.copy(Peer other)
      : this(
            id: other.id,
            hash: other.hash,
            password: other.password,
            username: other.username,
            hostname: other.hostname,
            platform: other.platform,
            alias: other.alias,
            tags: other.tags.toList(),
            forceAlwaysRelay: other.forceAlwaysRelay,
            rdpPort: other.rdpPort,
            rdpUsername: other.rdpUsername,
            loginName: other.loginName,
            device_group_name: other.device_group_name,
            note: other.note,
            sameServer: other.sameServer,
            enrollStatus: other.enrollStatus,
            arch: other.arch,
            os: other.os,
            osBits: other.osBits,
            diskTotal: other.diskTotal,
            diskFree: other.diskFree,
            tempBytes: other.tempBytes);
}

enum UpdateEvent { online, load }

typedef GetInitPeers = RxList<Peer> Function();

class Peers extends ChangeNotifier {
  final String name;
  final String loadEvent;
  List<Peer> peers = List.empty(growable: true);
  // Part of the peers that are not in the rest peers list.
  // When there're too many peers, we may want to load the front 100 peers first,
  // so we can see peers in UI quickly. `restPeerIds` is the rest peers' ids.
  // And then load all peers later.
  List<String> restPeerIds = List.empty(growable: true);
  final GetInitPeers? getInitPeers;
  UpdateEvent event = UpdateEvent.load;
  static const _cbQueryOnlines = 'callback_query_onlines';

  Peers(
      {required this.name,
      required this.getInitPeers,
      required this.loadEvent}) {
    peers = getInitPeers?.call() ?? [];
    platformFFI.registerEventHandler(_cbQueryOnlines, name, (evt) async {
      _updateOnlineState(evt);
    });
    platformFFI.registerEventHandler(loadEvent, name, (evt) async {
      _updatePeers(evt);
    });
  }

  @override
  void dispose() {
    platformFFI.unregisterEventHandler(_cbQueryOnlines, name);
    platformFFI.unregisterEventHandler(loadEvent, name);
    super.dispose();
  }

  Peer getByIndex(int index) {
    if (index < peers.length) {
      return peers[index];
    } else {
      return Peer.loading();
    }
  }

  int getPeersCount() {
    return peers.length;
  }

  void _updateOnlineState(Map<String, dynamic> evt) {
    int changedCount = 0;
    evt['onlines'].split(',').forEach((online) {
      for (var i = 0; i < peers.length; i++) {
        if (peers[i].id == online) {
          if (!peers[i].online) {
            changedCount += 1;
            peers[i].online = true;
          }
        }
      }
    });

    evt['offlines'].split(',').forEach((offline) {
      for (var i = 0; i < peers.length; i++) {
        if (peers[i].id == offline) {
          if (peers[i].online) {
            changedCount += 1;
            peers[i].online = false;
          }
        }
      }
    });

    if (changedCount > 0) {
      event = UpdateEvent.online;
      notifyListeners();
    }
  }

  void _updatePeers(Map<String, dynamic> evt) {
    final onlineStates = _getOnlineStates();
    if (getInitPeers != null) {
      peers = getInitPeers?.call() ?? [];
    } else {
      peers = _decodePeers(evt['peers']);
    }

    restPeerIds = [];
    if (evt['ids'] != null) {
      restPeerIds = (evt['ids'] as String).split(',');
    }

    for (var peer in peers) {
      final state = onlineStates[peer.id];
      peer.online = state != null && state != false;
    }
    event = UpdateEvent.load;
    notifyListeners();
  }

  Map<String, bool> _getOnlineStates() {
    var onlineStates = <String, bool>{};
    for (var peer in peers) {
      onlineStates[peer.id] = peer.online;
    }
    return onlineStates;
  }

  List<Peer> _decodePeers(String peersStr) {
    try {
      if (peersStr == "") return [];
      List<dynamic> peers = json.decode(peersStr);
      return peers.map((peer) {
        return Peer.fromJson(peer as Map<String, dynamic>);
      }).toList();
    } catch (e) {
      debugPrint('peers(): $e');
    }
    return [];
  }
}
