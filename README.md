# AI POC 산출물 평가 프로그램

## 실행

```powershell
npm start
```

서버가 실행되면 관리자 대시보드는 아래 주소로 접속합니다.

```text
http://127.0.0.1:8090/admin
```

모바일에서는 같은 네트워크에 접속한 뒤, 실행 로그에 표시되는 PC의 IP 주소를 사용합니다.

```text
http://PC-IP:8090/admin
http://PC-IP:8090/group1.html
http://PC-IP:8090/group2.html
http://PC-IP:8090/group3.html
http://PC-IP:8090/group4.html
http://PC-IP:8090/group5.html
```

## 그룹별 제외 과제 설정

`config.json`의 `groups[].excludedProjectIds`에 해당 그룹이 평가하지 않을 과제 ID를 넣습니다.

```json
{
  "id": "group1",
  "name": "1그룹",
  "excludedProjectIds": ["project01", "project02"]
}
```

과제 ID는 `config.json`의 `projects` 목록에서 확인할 수 있습니다.

## 중복 투표 방지

일반 모바일 웹은 IMEI를 읽을 수 없습니다. 이 프로그램은 IP 주소, 브라우저 단말키, 기기 지문을 조합해 중복 투표를 막습니다.

`config.json`의 `duplicatePolicy` 값으로 기준을 바꿀 수 있습니다.

```text
deviceOrIp  IP 또는 같은 단말이면 차단
deviceOnly  같은 단말이면 차단
ipOnly      같은 IP이면 차단
```

회사 Wi-Fi나 프록시 환경에서 여러 단말이 같은 IP로 잡히면 `deviceOnly`가 더 적합합니다.

## 점수 산정

각 과제는 4개 항목을 1-5점으로 평가합니다.

```text
원점수: 4-20점
최종점수: 원점수 x 5 = 20-100점
```

관리자 대시보드에서는 과제별 평균 점수와 항목별 평균을 확인하고 CSV로 내려받을 수 있습니다.

## 외부 서버 배포

외부 서버에서는 관리자 대시보드 보호를 위해 `ADMIN_PASSWORD` 환경 변수를 설정하세요.

```powershell
$env:ADMIN_PASSWORD="원하는관리자비밀번호"
npm start
```

데이터 저장 위치는 `DATA_DIR` 환경 변수로 바꿀 수 있습니다. Docker나 클라우드 persistent volume을 사용할 때 `/data`를 권장합니다.

```text
ADMIN_PASSWORD=관리자비밀번호
DATA_DIR=/data
PORT=8080
```

Docker 실행 예시는 아래와 같습니다.

```powershell
docker build -t ai-poc-evaluation .
docker run -p 8080:8080 -e ADMIN_PASSWORD=관리자비밀번호 -v ai-poc-votes:/data ai-poc-evaluation
```

Render에 올릴 때는 [DEPLOY_RENDER.md](DEPLOY_RENDER.md)를 따르면 됩니다.
