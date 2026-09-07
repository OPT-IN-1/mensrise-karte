// カルテが扱う人物情報フィールドの定義（現行ツール app/fields.py と同じ表）。
//   policy … dash: 空欄なら「—」／none: 空欄なら「特になし」／keep: 空欄のまま（必須なら未充足エラー）
//   input_mode … csv: CSV原本から取る／operator: CSVに無ければ画面入力を許す

export const FIELDS = [
  { key: "mid", section: "member", label: "MID（受講生ID）", policy: "keep", required: true, aliases: ["受講生id", "mid", "会員id", "会員番号", "メンバーid"], input_mode: "csv", multiline: false },
  { key: "name", section: "member", label: "氏名", policy: "keep", required: true, aliases: ["氏名", "お名前", "名前", "フルネーム"], input_mode: "csv", multiline: false },
  { key: "nickname", section: "member", label: "呼び名", policy: "keep", required: true, aliases: ["呼んで欲しい名前", "呼び名", "ニックネーム", "呼ばれ方", "あだ名"], input_mode: "csv", multiline: false },
  { key: "join_month", section: "member", label: "入会月", policy: "dash", required: false, aliases: ["入会月", "入会日", "開始月", "受講開始", "タイムスタンプ"], input_mode: "csv", multiline: false },
  { key: "age", section: "member", label: "年齢", policy: "dash", required: true, aliases: ["年齢", "お歳", "歳"], input_mode: "operator", multiline: false },
  { key: "height_cm", section: "member", label: "身長", policy: "dash", required: true, aliases: ["身長"], input_mode: "operator", multiline: false },
  { key: "weight_kg", section: "member", label: "体重", policy: "dash", required: true, aliases: ["体重"], input_mode: "operator", multiline: false },
  { key: "body_fat_pct", section: "member", label: "体脂肪率", policy: "dash", required: false, aliases: ["体脂肪率", "体脂肪"], input_mode: "csv", multiline: false },
  { key: "occupation", section: "member", label: "職業", policy: "dash", required: false, aliases: ["職業", "お仕事", "職種"], input_mode: "csv", multiline: false },
  { key: "reason_for_joining", section: "member", label: "入会理由", policy: "none", required: false, aliases: ["サロンに入った理由", "入会理由", "入会のきっかけ", "参加理由", "申込理由"], input_mode: "csv", multiline: false },
  { key: "things_to_stop", section: "member", label: "辞めること", policy: "none", required: false, aliases: ["辞めること", "やめること", "断つこと", "やめたいこと"], input_mode: "csv", multiline: false },
  { key: "qualitative_goal", section: "goals", label: "定性的ゴール", policy: "none", required: true, aliases: ["あなたの定性的ゴール", "定性的ゴール", "目指す姿", "なりたい姿", "理想の姿"], input_mode: "csv", multiline: false },
  { key: "weight_goal_from_csv", section: "goals", label: "体重の数値目標", policy: "keep", required: false, aliases: ["目標体重", "体重目標"], input_mode: "csv", multiline: false },
  { key: "body_fat_goal_from_csv", section: "goals", label: "体脂肪率の数値目標", policy: "keep", required: false, aliases: ["目標体脂肪率", "体脂肪率目標", "目標体脂肪"], input_mode: "csv", multiline: false },
  { key: "other_goal_from_csv", section: "goals", label: "その他の数値目標", policy: "keep", required: false, aliases: ["その他目標", "数値目標", "その他の目標"], input_mode: "csv", multiline: false },
  { key: "eyebrow_shape", section: "beauty", label: "眉の形", policy: "dash", required: true, aliases: ["眉の形", "眉毛の形", "眉形"], input_mode: "csv", multiline: false },
  { key: "eyebrow_amount", section: "beauty", label: "眉の量", policy: "dash", required: true, aliases: ["眉毛の量", "眉の量"], input_mode: "csv", multiline: false },
  { key: "eyebrow_density", section: "beauty", label: "眉の濃さ", policy: "dash", required: true, aliases: ["まゆげの濃さ", "眉の濃さ", "眉毛の濃さ", "眉の濃淡"], input_mode: "csv", multiline: false },
  { key: "skin_type", section: "beauty", label: "肌タイプ", policy: "dash", required: true, aliases: ["肌タイプ", "肌質"], input_mode: "csv", multiline: false },
  { key: "current_skincare", section: "beauty", label: "現在のケア状況", policy: "none", required: false, aliases: ["今使っているスキンケア", "現在のスキンケア", "現在のケア", "スキンケア状況"], input_mode: "csv", multiline: false },
  { key: "beauty_concerns", section: "beauty", label: "美容の悩み・相談", policy: "none", required: false, aliases: ["事前に相談したいこと", "美容の悩み", "肌の悩み", "美容に関する悩み"], input_mode: "csv", multiline: false },
  { key: "procedure_routine", section: "beauty", label: "施術ルーティン", policy: "none", required: false, aliases: ["施術ルーティン", "施術頻度", "美容施術", "通っている施術"], input_mode: "csv", multiline: false },
  { key: "current_location", section: "training", label: "現在のトレーニング場所", policy: "dash", required: true, aliases: ["トレーニング場所", "運動場所", "どこで運動", "トレーニング環境"], input_mode: "csv", multiline: false },
  { key: "current_status", section: "training", label: "現在のトレーニング状況", policy: "dash", required: true, aliases: ["筋トレ経験", "トレーニング状況", "筋トレ状況", "運動習慣"], input_mode: "csv", multiline: false },
  { key: "current_frequency", section: "training", label: "現在／希望の頻度", policy: "dash", required: true, aliases: ["現在の運動頻度", "トレーニング頻度", "運動頻度", "週何回"], input_mode: "csv", multiline: false },
  { key: "exercise_time_weekday", section: "training", label: "平日の運動時間", policy: "dash", required: false, aliases: ["平日に運動に使える時間", "平日の運動時間", "平日運動時間", "平日にとれる時間"], input_mode: "csv", multiline: false },
  { key: "exercise_time_holiday", section: "training", label: "休日の運動時間", policy: "dash", required: false, aliases: ["休日に運動に使える時間", "休日の運動時間", "休日運動時間", "休日にとれる時間"], input_mode: "csv", multiline: false },
  { key: "injury_or_condition", section: "training", label: "怪我／持病", policy: "none", required: false, aliases: ["痛みが出やすい部位", "ケガ/持病", "怪我", "持病", "既往"], input_mode: "csv", multiline: false },
  { key: "training_concerns", section: "training", label: "筋トレの悩み", policy: "none", required: false, aliases: ["過去に続かなかった理由", "筋トレの悩み", "トレーニングの悩み", "身体の悩み"], input_mode: "csv", multiline: false },
  { key: "hair_concerns", section: "hair", label: "髪の悩み", policy: "none", required: false, aliases: ["髪の悩みを具体的", "髪の悩み", "ヘアの悩み", "頭髪の悩み"], input_mode: "csv", multiline: false },
  { key: "styling_frequency", section: "hair", label: "スタイリング頻度", policy: "dash", required: false, aliases: ["スタイリングはどのくらいの頻度", "スタイリング頻度", "セット頻度"], input_mode: "csv", multiline: false },
  { key: "roadmap_1m", section: "roadmap", label: "1ヶ月後の目標", policy: "none", required: false, aliases: ["1ヶ月後のゴール", "1ヶ月後", "一ヶ月後", "1か月後"], input_mode: "operator", multiline: true },
  { key: "roadmap_3m", section: "roadmap", label: "3ヶ月後の目標（最重要）", policy: "none", required: false, aliases: ["3ヶ月後のゴール", "3ヶ月後", "三ヶ月後", "3か月後"], input_mode: "operator", multiline: true },
  { key: "roadmap_6m", section: "roadmap", label: "半年後の目標", policy: "none", required: false, aliases: ["半年後のゴール", "半年後", "6ヶ月後", "6か月後"], input_mode: "operator", multiline: true },
  { key: "roadmap_1y", section: "roadmap", label: "1年後の目標", policy: "none", required: false, aliases: ["1年後のゴール", "1年後", "一年後"], input_mode: "operator", multiline: true },
  { key: "roadmap_final", section: "roadmap", label: "最終ゴール", policy: "none", required: false, aliases: ["サロンでのゴール", "最終ゴール", "最終目標"], input_mode: "operator", multiline: true },
  { key: "vision_training", section: "vision", label: "外見イメージ：筋トレ・食事", policy: "none", required: false, aliases: ["どんな体型ですか", "理想の体", "なりたい体", "筋トレの理想"], input_mode: "operator", multiline: true },
  { key: "vision_beauty", section: "vision", label: "外見イメージ：美容", policy: "none", required: false, aliases: ["初対面での清潔感", "理想の肌", "美容の理想"], input_mode: "operator", multiline: true },
  { key: "vision_hair", section: "vision", label: "外見イメージ：ヘアスタイル", policy: "none", required: false, aliases: ["どんな髪型ですか", "理想の髪", "ヘアの理想"], input_mode: "operator", multiline: true },
  { key: "vision_fashion", section: "vision", label: "外見イメージ：ファッション", policy: "none", required: false, aliases: ["どんな服を着ていますか", "理想の服装", "ファッションの理想"], input_mode: "operator", multiline: true },
  { key: "vision_impression", section: "vision", label: "初対面の印象", policy: "none", required: false, aliases: ["どんな印象を持ちますか", "初対面の印象", "与えたい印象"], input_mode: "operator", multiline: true },
  { key: "hair_face_shape", section: "hair", label: "顔型", policy: "dash", required: false, aliases: ["自分の顔型", "顔型", "顔の形"], input_mode: "operator", multiline: false },
  { key: "hair_desired_impression", section: "hair", label: "希望する印象", policy: "none", required: false, aliases: ["希望する印象", "なりたい雰囲気", "ヘアの希望"], input_mode: "operator", multiline: false },
  { key: "hair_target_style", section: "hair", label: "目標スタイル", policy: "none", required: false, aliases: ["どのようなヘアスタイルを希望", "目標スタイル", "なりたい髪型", "希望の髪型"], input_mode: "operator", multiline: false },
  { key: "hair_cut_place", section: "hair", label: "カットする場所", policy: "dash", required: false, aliases: ["普段カットする場所", "カットする場所", "美容室", "行きつけ"], input_mode: "operator", multiline: false },
  { key: "concerns_beauty", section: "beauty", label: "美容の現状の悩み（1行1件）", policy: "none", required: false, aliases: [], input_mode: "operator", multiline: true },
  { key: "concerns_training", section: "training", label: "筋トレの現状の悩み（1行1件）", policy: "none", required: false, aliases: [], input_mode: "operator", multiline: true },
  { key: "concerns_hair", section: "hair", label: "ヘアの現状の悩み（1行1件）", policy: "none", required: false, aliases: [], input_mode: "operator", multiline: true },
  { key: "goal_deadline", section: "goals", label: "目標の期限", policy: "dash", required: false, aliases: ["期限", "達成期限", "いつまで"], input_mode: "operator", multiline: false },
];

export const BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
export const SECTIONS = ["member", "goals", "roadmap", "vision", "beauty", "training", "hair"];
export const SECTION_LABEL = {
  "member": "基本情報",
  "goals": "ゴール",
  "beauty": "美容",
  "training": "筋トレ",
  "hair": "ヘア",
  "roadmap": "ロードマップ",
  "vision": "外見イメージング"
};
export const BLANK_DISPLAY = {"dash": "—", "none": "特になし", "keep": ""};

export const PHOTO_ROLES = [
  { role: "face", label: "顔・髪（Sheet2・Sheet4）", ratio: "4:5", hint: "顔・眉・髪の長さが確認できる正面" },
  { role: "overview", label: "全身（Sheet1）", ratio: "3:4", hint: "本人の印象が分かる縦構図" },
  { role: "training_front", label: "トレーニング正面（Sheet3）", ratio: "2:3", hint: "正面から身体が十分に見える" },
  { role: "training_side", label: "トレーニング側面（Sheet3）", ratio: "2:3", hint: "側面から身体が十分に見える" },
  { role: "training_back", label: "トレーニング背面（Sheet3）", ratio: "2:3", hint: "背面から身体が十分に見える" },
  { role: "hair", label: "ヘア（Sheet4）", ratio: "3:4", hint: "髪の長さ・シルエットが判断できる" },
];
export const PHOTO_ROLE_KEYS = PHOTO_ROLES.map((p) => p.role);
// 顔とヘアは同じ写真を使う（毎月もらう写真は5枚）。顔を確定すると自動で作られる。
export const DERIVED_PHOTOS = {"hair": "face"};
export const OPERATOR_PHOTO_ROLES = PHOTO_ROLES.filter((p) => !(p.role in DERIVED_PHOTOS));
