# Untangle Vercel 배포 안내

확인 기준일: 2026-11-12. **설정과 절차만 준비했으며 실제 배포·프로젝트 연결·환경 변수 업로드는 하지 않았습니다.**

## 준비된 설정

| 항목 | 설정 |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `package.json`이 있는 프로젝트 루트 |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Next.js 기본값 유지 |
| Node.js | `package.json`·lock의 `engines.node=24.x` |
| 카드 함수 | Node.js 런타임, `vercel.json`의 `app/api/cards/route.ts` 최대 300초 |
| 저장 | 브라우저 localStorage. 서버 DB 불필요 |

현재 Vercel 공식 문서에서 Node 24.x를 지원합니다. 프로젝트 기본 Node 버전에 의존하지 않고 `engines`로 24.x를 고정했습니다. [지원 버전과 설정](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

앱의 SDK 호출 제한은 한 번에 120초이고 응답 후보가 전부 탈락하면 최대 한 번 더 호출합니다. 따라서 최대 약 240초와 처리 여유를 고려해 함수 상한을 **300초**로 정했습니다. 이는 앱 코드에서 도출한 설정 선택입니다. Vercel의 Fluid compute에서는 Hobby도 300초를 지원하므로 배포 프로젝트에서 Fluid compute와 실제 함수 제한을 확인하세요. [함수 실행 시간](https://vercel.com/docs/functions/configuring-functions/duration)

함수 상한과 SDK의 요청 제한은 서로 다른 설정입니다. 앱의 재시도·타임아웃 코드를 바꾸지는 않았습니다.

## 서버 환경 변수

Vercel 프로젝트의 **Settings → Environment Variables**에서 아래 값을 Preview와 Production에 각각 설정합니다.

| 변수 | 값 |
|---|---|
| `OPENAI_API_KEY` | 사용자 본인의 서버용 API 키 |
| `OPENAI_MODEL` | `gpt-5.6-terra` 또는 사용자가 선택한 호환 모델 |

키에 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다. 로컬 `.env.local` 파일을 올리는 대신 프로젝트 환경 변수로 설정합니다. `OPENAI_BASE_URL`은 QA helper용이므로 배포에 추가하지 않습니다. 환경 변수를 바꾸면 새 배포에 적용해야 합니다. [환경 변수 관리](https://vercel.com/docs/environment-variables/managing-environment-variables)

샘플 모드와 온보딩의 로컬 파싱은 LLM을 호출하지 않습니다. 실제 카드 생성을 사용하는 환경에만 키가 필요합니다.

## 런타임에서 읽는 프롬프트 파일

`lib/prompts.ts`와 `lib/onboarding-prompt.ts`는 프로젝트 루트를 기준으로 다음 파일을 읽습니다.

- `docs/nudge_prompt.md`
- `docs/onboarding_prompts.md`

현재 로컬 배포용 빌드에서 해당 파일 포함을 확인했습니다.

- `.next/server/app/api/cards/route.js.nft.json`: `docs/nudge_prompt.md`
- `.next/server/app/start/page.js.nft.json`: `docs/onboarding_prompts.md`

따라서 현재는 `next.config.ts`에 추가 설정이 필요하지 않습니다. `docs/`를 배포 제외 목록에 넣지 마세요. Vercel은 파일 추적으로 런타임 파일을 포함하며, Next.js에서 누락을 보완할 때는 `next.config`의 `outputFileTracingIncludes`를 사용합니다. `vercel.json`의 `includeFiles`는 Next.js용 대체 설정이 아닙니다. [함수 파일 읽기](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions), [프로젝트 설정](https://vercel.com/docs/project-configuration/vercel-json)

향후 trace에서 빠지는 경우에는 설치된 Next.js의 `node_modules/next/dist/docs/` 안내를 먼저 읽고 필요한 두 경로만 좁게 포함하도록 수정한 뒤 다시 빌드·확인합니다. 현재 작업에서는 함수나 Next.js 코드를 바꾸지 않았습니다. 샘플 카드 JSON은 클라이언트 번들에서 가져오므로 별도 런타임 파일 읽기가 필요하지 않습니다.

## 글꼴과 정적 라이선스

3화면 개편에서는 공식 npm `pretendard` 1.3.9 패키지의 `PretendardVariable.woff2`를 `next/font/local`로 제공합니다. 패키지는 `npm ci`에서 설치되고 글꼴은 Next.js 빌드의 정적 자산으로 제공되므로 외부 글꼴 CDN이나 서버의 런타임 파일 읽기가 필요하지 않습니다. 글꼴 때문에 `outputFileTracingIncludes`나 Vercel 함수 설정을 추가하지 않습니다.

SIL OFL 1.1 원문은 `public/licenses/Pretendard-LICENSE.txt`입니다. `public/`는 배포 제외 목록에 넣지 않았습니다. Preview에서 앱 글꼴 자산과 `/licenses/Pretendard-LICENSE.txt`가 같은 배포에서 제공되는지 확인하세요.

## Git·배포에서 제외하는 자료

`.gitignore`와 `.vercelignore`에 로컬 환경 파일, `out/`, 모든 zip 등 아카이브와 생성물 제외 규칙을 추가했습니다. `.vercelignore`는 `scripts/`와 `tests/`도 제외하므로 모의 upstream·실제 API 검증 helper가 배포 소스에 들어가지 않습니다. 앱에 필요한 `app/`, `components/`, `lib/`, `docs/`, `samples/`는 남깁니다.

특히 `out.zip`도 `*.zip` 규칙으로 제외합니다. 압축 결과가 가상 자료더라도 검증 출력과 입력 묶음을 배포에 넣지 않습니다. 제공된 원본 zip도 로컬 참고 자료로만 남고 앱은 이미 푼 `docs/`와 코드·가상 샘플을 사용합니다.

`.vercelignore`의 업로드 제외 동작과 Git의 추적 여부는 다릅니다. Git 배포에서는 이미 커밋한 비밀·결과 파일을 ignore 규칙만 추가해 없앨 수 없습니다. [배포 제외 파일](https://vercel.com/docs/deployments/vercel-ignore), [CLI와 Git의 제외 차이](https://vercel.com/docs/builds/build-features)

현재 폴더에는 `.git`이 없고 부모에서도 저장소가 확인되지 않았습니다. 따라서 **tracked 파일과 커밋 이력의 비밀 유무는 검사할 수 없었습니다.** Git 저장소를 초기화하거나 원격에 올리지 않았습니다. 나중에 사용자가 저장소를 연결할 때 실제 추적 목록과 이력까지 확인해야 합니다.

로컬 `.env.local`은 **존재하며 키가 설정돼 있습니다.** 파일이 없다고 보고하지 않습니다. 값은 출력하지 않았고 현재 ignore 규칙으로 제외했습니다. 파일·빌드·zip 항목 검사에서 이 파일 이외의 실제 키 일치 경로는 발견되지 않았습니다. 상세 감사 결과는 로컬 `out/final-qa-2026-11-12/deployment-audit.json`과 `archive-audit.json`에 있습니다. 이는 점검 시점의 파일 검사이며 공개 배포 검증을 대신하지 않습니다.

## 사용자가 직접 진행할 단계

1. 로컬에서 `npm ci`, `npm test`, `npm run typecheck`, `npm run build`를 실행합니다. 필요한 개인 자료는 브라우저 안에 두고 소스·압축 파일에 넣지 않습니다.
2. 검토한 소스를 사용자 소유 Git 저장소 또는 Vercel CLI 프로젝트에 연결합니다. 현재 폴더에 Git 이력이 없으므로 연결 방식과 원격 저장소는 사용자가 선택해야 합니다.
3. 위 표의 Next.js·루트·명령·Node 24.x 설정과 Fluid compute를 확인합니다. `vercel.json`의 카드 함수 제한이 300초로 적용되는지도 확인합니다.
4. Preview용 환경 변수 두 개를 프로젝트에 직접 넣습니다. 모의 서버 주소와 `local-qa-only` 키를 넣지 않습니다.
5. CLI 프로젝트를 연결했다면 업로드 전에 `vercel deploy --dry --format=json`으로 포함 파일을 확인할 수 있습니다. `.env.local`, `out/`, `out.zip`, 제공 zip, `scripts/`가 포함되지 않는지 확인합니다. 이 명령은 지원되는 최신 CLI에서 실제 업로드 없이 목록을 만듭니다. 현재 작업에서는 CLI 프로젝트가 연결되지 않아 실행하지 않았습니다. [Dry-run 안내](https://vercel.com/changelog/dry-run-deployments-with-vercel-cli)
6. 사용자가 Preview 배포를 만듭니다. `/start`, 오늘(`/`), 토픽 목록(`/topics`), 토픽 이름을 눌러 들어가는 보드(`/topics/[id]`), 두 샘플 페르소나, `/kit`, 개인 기록 복귀를 확인합니다. 토픽 보드는 열기만 해서는 API를 호출하지 않으며 버튼으로 해당 토픽 한 개만 요청합니다. 샘플 조작·토픽 요청·새로고침은 모두 API 호출 없이 동작해야 합니다. 카드 실연결을 시험할 때는 가상 페르소나만 사용하고 사용자가 정한 호출 수 안에서 확인합니다.
7. 카드 생성과 오류 상태, 같은 날 캐시, 수정 초안·체크리스트·진행 중 카드의 새로고침 보존을 확인합니다. 실제 사용자 원문이나 API 키를 로그·스크린샷에 남기지 않습니다.
8. Preview를 검토한 후 Production 환경 변수를 설정하고 사용자가 Production 배포 또는 승격을 실행합니다. 배포 URL과 새 환경에서의 확인 결과를 따로 기록합니다.

프로젝트 계정과 환경 변수 설정, 실제 Preview·Production 배포, 공개 URL 검증은 아직 수행하지 않은 사용자 단계입니다.
