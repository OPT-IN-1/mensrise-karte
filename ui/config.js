// このツールがGoogleと通信するときに使う公開ID。
//
// クライアントIDとAPIキーは、ブラウザで動くアプリでは必ず利用者に見えるもので、
// パスワードや秘密鍵ではない。悪用されないよう、Google Cloud側で
// 「このツールのURLからのリクエストだけ」「Drive/Pickerだけ」に制限してある。
//
// 発行元：Google Cloud プロジェクト mensrise-karte（個人アカウント）
export const CLIENT_ID = '1077796418649-ehsvdf5ltgoavkp776moidsue4p4u3of.apps.googleusercontent.com';
export const API_KEY = 'AIzaSyCvhDXyFgoLaoCWX3_p_kybTP-fq0zFcFw';

// 月次フォームの回答が入るスプレッドシート（「月次フォーム」タブを自動で読む）。
// IDだけでは中身は見えない（ドライブに接続したアカウントの権限で読む）。
export const FORM_SHEET_ID = '1qgm_kogozmyqe6ZNUFfxbjjKbtDiXFPiiqNYd1zvfpo';
