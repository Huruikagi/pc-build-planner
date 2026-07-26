/** `resolveInitialLanguage` の入力。ブラウザAPIを直接呼ばず、値として受け取る（8.3）。 */
export interface LanguageResolutionInput {
  readonly stored: unknown;
  readonly browserUiLanguage: unknown;
}
