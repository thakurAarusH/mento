// Plain-language legal pages in English and Japanese. Drafts for a hackathon prototype: not legal advice.
const OP = {
  en: 'ONIGIRI BENTO (hackathon team). Legal name, address and grievance contact: [TO BE CONFIRMED BY PROJECT OWNER]. Contact: [AUTHORISED CONTACT METHOD — NOT YET SUPPLIED].',
  ja: 'ONIGIRI BENTO（ハッカソンチーム）。正式名称・所在地・苦情窓口：［プロジェクト責任者が確認予定］。連絡先：［認められた連絡方法 — 未提供］。',
};
const COOKIE_TABLE = {
  en: '<div class="scroll"><table><thead><tr><th>Name</th><th>Purpose</th><th>Provider</th><th>Category</th><th>Lifetime</th><th>Strictly necessary</th></tr></thead><tbody><tr><td><code>mz</code></td><td>Keeps a master signed in to their account</td><td>This app (first party)</td><td>Authentication</td><td>30 days</td><td>Yes</td></tr><tr><td><code>mz_lang</code></td><td>Remembers the interface language (English / 日本語)</td><td>This app (first party)</td><td>Preference</td><td>1 year</td><td>Yes (functional, set only when the page is used)</td></tr></tbody></table></div><p>The student and master phones also keep a few values in the browser\'s local storage on that device only: the invite for the session last joined, an anonymous random device id for learning progress, and the language choice. Nothing is used for analytics or advertising.</p>',
  ja: '<div class="scroll"><table><thead><tr><th>名前</th><th>目的</th><th>提供者</th><th>分類</th><th>有効期間</th><th>必須</th></tr></thead><tbody><tr><td><code>mz</code></td><td>師匠のアカウントのログイン状態を保つ</td><td>本アプリ（ファーストパーティ）</td><td>認証</td><td>30日</td><td>はい</td></tr><tr><td><code>mz_lang</code></td><td>表示言語（English / 日本語）を記憶する</td><td>本アプリ（ファーストパーティ）</td><td>設定</td><td>1年</td><td>はい（機能上必要。ページを使った時のみ設定）</td></tr></tbody></table></div><p>生徒用・師匠用のスマートフォンは、その端末のブラウザのローカルストレージにだけ、最後に参加したセッションの招待、学習進捗のための匿名のランダムな端末ID、言語の選択を保存します。分析や広告には一切使いません。</p>',
};
const L = {
  en: {
    privacy: ['Privacy Policy', [
      ['Status', 'MENTO is a free, non-commercial hackathon prototype. This page is a draft in plain language; it is not legal advice and does not claim legal compliance. It needs review by the project owner and counsel before any real deployment.'],
      ['Who is responsible', OP.en],
      ['What we collect and why', 'Masters: name, username and a password (stored only as a salted hash), video and audio of their work, typed or spoken answers and edits, and any manual they upload. Students: periodic camera snapshots during practice, questions typed to the master, and which lessons an anonymous device marked as learned. No names are needed from students.'],
      ['How it is processed', 'Everything is stored on the operator\'s own computer in a private folder and shown only through short-lived signed links. Video analysis, speech-to-text (Whisper) and read-aloud voices (Open JTalk, espeak-ng) run locally on that computer; nothing is sent to a cloud AI service.'],
      ['Consent', 'Before any camera or microphone use you must tick an unticked consent box on your own device. Consent covers recording and analysis for the session only. No use for model training or marketing.'],
      ['Retention and deletion', 'Sessions are deleted automatically after the operator\'s retention period (default 30 days). Masters can delete recordings, questions, knowledge records and help requests; these stay in "Recently deleted" for 7 days so mistakes can be undone, then are removed for good. A whole session can be deleted at once.'],
      ['Security', 'Private storage, personal master accounts that see only their own sessions, time-limited invitations, signed expiring media links, rate limits, input limits and no analytics. No system is perfectly secure; operators must handle incidents and notify affected people where the law requires.'],
      ['Cross-border processing', 'None by default: data stays on the operator\'s machine. A tunnel service used for remote access carries encrypted traffic through its servers.'],
      ['Your rights', 'Ask the operator to access, correct or delete your data or to withdraw consent. Withdrawing consent stops further recording; it does not undo lawful processing already done.'],
      ['AI limitations', 'AI questions, drafts and photo checks come from sampled still images, the master\'s words and approved records. They can be wrong, cannot see hidden defects, and are not a certification or safety inspection.'],
    ]],
    terms: ['Terms and Conditions', [
      ['Prototype', 'MENTO is an unfinished hackathon prototype provided free of charge and as is, without warranties. Do not rely on it for safety-critical or certification decisions.'],
      ['Operator', OP.en + ' This project is not endorsed by Thapar Institute, JETRO or any other organisation.'],
      ['Your responsibilities', 'Only record people who have consented and content you have the right to record. Do not upload unlawful material or manuals you may not share. Follow workshop safety rules; qualified human supervision is required. In Japan, only licensed swordsmiths may make swords.'],
      ['Expert knowledge', 'Records are the master\'s own explanations; the AI only drafts them from the master\'s words. The master decides what is approved. Approval does not make advice correct for every situation.'],
      ['Payments', 'There are no payments, purchases or subscriptions, so no refund policy applies to this version.'],
      ['Liability and governing law', '[TO BE CONFIRMED BY COUNSEL: limitation of liability, governing law and jurisdiction.]'],
    ]],
    cookies: ['Cookie Policy', [
      ['Summary', 'We set only strictly necessary first-party cookies: one keeps a master signed in, one remembers the interface language. We use no analytics, advertising or tracking and load no third-party scripts, fonts or embeds.'],
      ['Inventory', COOKIE_TABLE.en],
      ['Third-party requests', 'None from the application itself. If a tunnel is used for remote access, that provider sees encrypted traffic metadata.'],
    ]],
  },
  ja: {
    privacy: ['プライバシーポリシー', [
      ['位置づけ', 'MENTOは無料・非営利のハッカソン用試作品です。このページは平易な言葉による草案であり、法的助言ではなく、法令への適合を主張するものでもありません。実際に運用する前に、プロジェクト責任者と専門家の確認が必要です。'],
      ['責任者', OP.ja],
      ['収集する情報と目的', '師匠：氏名、ユーザー名、パスワード（ソルト付きハッシュとしてのみ保存）、作業の映像と音声、入力または音声で答えた内容と編集、アップロードしたマニュアル。生徒：練習中に定期的に撮影する静止画、師匠への質問、匿名の端末が「理解した」と記録したレッスン。生徒の名前は必要ありません。'],
      ['処理の方法', 'すべての情報は運営者自身のコンピューターの非公開フォルダーに保存され、短時間だけ有効な署名付きリンクでのみ表示されます。映像の分析、音声の文字起こし（Whisper）、読み上げ音声（Open JTalk、espeak-ng）はすべてそのコンピューター上で動作し、クラウドのAIサービスには何も送信しません。'],
      ['同意', 'カメラやマイクを使う前に、ご自身の端末で、最初はチェックの入っていない同意欄にチェックを入れていただく必要があります。同意の範囲は、そのセッションのための録画と分析だけです。AIの学習や宣伝には使いません。'],
      ['保存期間と削除', 'セッションは運営者が定めた保存期間（初期設定は30日）の経過後に自動で削除されます。師匠は録画、質問、知識の記録、ヘルプ依頼を削除できます。削除したものは間違いを取り消せるよう7日間「最近削除した項目」に残り、その後完全に削除されます。セッション全体をまとめて削除することもできます。'],
      ['安全管理', '非公開の保存場所、自分のセッションだけが見える師匠ごとのアカウント、期限付きの招待、署名付きで期限のあるメディアリンク、試行回数の制限、入力の制限を設け、アクセス解析は行いません。完全に安全なシステムはありません。運営者は事故に対応し、法令が求める場合は影響を受けた方に通知する必要があります。'],
      ['国外での処理', '初期設定では行いません。データは運営者のコンピューターにとどまります。遠隔アクセスにトンネルサービスを使う場合、暗号化された通信がそのサーバーを経由します。'],
      ['あなたの権利', '運営者に対し、ご自身のデータの開示・訂正・削除や、同意の撤回を求めることができます。同意を撤回するとそれ以降の録画は止まりますが、すでに適法に行われた処理が取り消されるわけではありません。'],
      ['AIの限界', 'AIによる質問、記録の下書き、写真のチェックは、抜き出した静止画、師匠の言葉、承認済みの記録にもとづきます。誤ることがあり、見えない欠陥はわからず、認定や安全検査ではありません。'],
    ]],
    terms: ['利用規約', [
      ['試作品', 'MENTOは未完成のハッカソン用試作品であり、無料で、現状のまま、いかなる保証もなく提供されます。安全に関わる判断や認定の判断に使わないでください。'],
      ['運営者', OP.ja + ' 本プロジェクトは、Thapar Institute、JETRO、その他いかなる団体の推奨も受けていません。'],
      ['利用者の責任', '同意した人と、録画する権利のある内容だけを録画してください。違法な素材や、共有してはいけないマニュアルをアップロードしないでください。工房の安全規則を守り、資格のある人の監督のもとで作業してください。日本では、刀は作刀承認を受けた刀匠だけが作れます。'],
      ['師匠の知識', '記録は師匠自身の説明であり、AIは師匠の言葉から下書きを作るだけです。何を承認するかは師匠が決めます。承認されたからといって、その助言があらゆる状況で正しいとは限りません。'],
      ['支払い', '支払い、購入、定期購読は一切ないため、このバージョンには返金規定はありません。'],
      ['責任と準拠法', '［専門家が確認予定：責任の制限、準拠法、管轄］'],
    ]],
    cookies: ['Cookieポリシー', [
      ['概要', '設定するのは、必要不可欠なファーストパーティのCookieだけです。ひとつは師匠のログイン状態を保ち、もうひとつは表示言語を記憶します。アクセス解析、広告、追跡は行わず、第三者のスクリプト、フォント、埋め込みも読み込みません。'],
      ['一覧', COOKIE_TABLE.ja],
      ['第三者への通信', 'アプリ自体からはありません。遠隔アクセスにトンネルを使う場合、そのサービス提供者には暗号化された通信のメタデータが見えます。'],
    ]],
  },
};
// When the operator turns on hybrid mode (lib/cloud.js), the pages say exactly what is sent to which provider.
const CLOUD = {
  en: (c) => {
    const what = [c.mode === 'vision' ? 'still frames from recordings and student practice photos' : '', c.mode !== 'off' ? 'text: descriptions of what the footage shows, the master\'s typed or transcribed answers, approved records, student questions and manual excerpts' : '', c.stt ? 'the master\'s spoken answers (audio)' : ''].filter(Boolean).join('; ');
    return {
      processed: `Data is stored on the operator's own computer in a private folder and shown only through short-lived signed links. The operator has turned on <strong>hybrid AI</strong>: to improve accuracy, some processing is done by cloud AI services — ${c.mode !== 'off' ? `${c.provider} (${c.model})` : ''}${c.mode !== 'off' && c.stt ? ' and ' : ''}${c.stt ? `a speech-to-text service at ${c.stt.host}` : ''}. Sent: ${what}. Not sent: names, accounts, passwords or full videos. Read-aloud voices run locally. If a cloud service fails, the local models are used instead. Cloud providers process this data under their API terms (API data is not used to train their models by default and may be kept for a limited time, typically up to 30 days, for abuse monitoring).`,
      cross: 'Yes, for the hybrid AI described above: the cloud AI providers may process the data outside your country (for example in the United States). A tunnel service used for remote access also carries encrypted traffic through its servers.',
      third: `The server (not your browser) sends AI requests to ${[c.mode !== 'off' ? c.provider : '', c.stt ? c.stt.host : ''].filter(Boolean).join(' and ')}. If a tunnel is used for remote access, that provider sees encrypted traffic metadata.`,
    };
  },
  ja: (c) => {
    const what = [c.mode === 'vision' ? '録画から抜き出した静止画と生徒の練習写真' : '', c.mode !== 'off' ? 'テキスト（映像に写っている内容の説明、師匠が入力または音声で答えた内容、承認済みの記録、生徒の質問、マニュアルの抜粋）' : '', c.stt ? '師匠の音声による回答（音声データ）' : ''].filter(Boolean).join('、');
    return {
      processed: `情報は運営者自身のコンピューターの非公開フォルダーに保存され、短時間だけ有効な署名付きリンクでのみ表示されます。運営者は<strong>ハイブリッドAI</strong>を有効にしています。精度を高めるため、一部の処理をクラウドのAIサービス（${c.mode !== 'off' ? `${c.provider}（${c.model}）` : ''}${c.mode !== 'off' && c.stt ? '、' : ''}${c.stt ? `${c.stt.host} の音声認識サービス` : ''}）で行います。送信するもの：${what}。送信しないもの：氏名、アカウント、パスワード、動画全体。読み上げ音声はこのコンピューター上で動作します。クラウドのサービスが使えない場合は、ローカルのモデルを使います。クラウドの提供者は、各社のAPI規約に従ってデータを処理します（APIのデータは初期設定ではモデルの学習に使われず、不正利用の監視のため一定期間〔通常最長30日〕保存されることがあります）。`,
      cross: 'はい。上記のハイブリッドAIのため、クラウドAIの提供者が国外（例：米国）でデータを処理する場合があります。遠隔アクセスにトンネルサービスを使う場合、暗号化された通信がそのサーバーも経由します。',
      third: `AIの依頼は、ブラウザーではなくサーバーから ${[c.mode !== 'off' ? c.provider : '', c.stt ? c.stt.host : ''].filter(Boolean).join(' と ')} に送信されます。遠隔アクセスにトンネルを使う場合、その提供者には暗号化された通信のメタデータが見えます。`,
    };
  },
};
const SEC = { en: { processed: 'How it is processed', cross: 'Cross-border processing', third: 'Third-party requests' }, ja: { processed: '処理の方法', cross: '国外での処理', third: '第三者への通信' } };
export function renderLegal(key, lang = 'en', cloud = null) {
  const l = lang === 'ja' ? 'ja' : 'en', other = l === 'ja' ? 'en' : 'ja';
  let [title, secs] = L[l][key];
  if (cloud && (cloud.mode !== 'off' || cloud.stt)) {
    const c = CLOUD[l](cloud), by = Object.fromEntries(Object.entries(SEC[l]).map(([k, h]) => [h, c[k]]));
    secs = secs.map(([h, t]) => [h, by[h] ?? t]);
  }
  const body = secs.map(([h, t]) => `<section><h2>${h}</h2>${t.startsWith('<') ? t : `<p>${t}</p>`}</section>`).join('');
  const back = l === 'ja' ? '← MENTOに戻る' : '← Back to MENTO', sw = l === 'ja' ? 'English' : '日本語';
  return `<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — MENTO</title><script src="/theme.js"></script><link rel="stylesheet" href="/style.css"></head><body><header class="top"><a href="/" class="brand">MENTO</a><button type="button" class="theme-toggle" id="theme-toggle" aria-label="${l === 'ja' ? '表示を切り替える' : 'Switch theme'}"></button><a class="lang-toggle" href="/${key}?lang=${other}">${sw}</a></header><script src="/theme-toggle.js"></script><main class="wrap legal"><p><a href="/">${back}</a></p><h1>${title}</h1>${body}</main></body></html>`;
}
