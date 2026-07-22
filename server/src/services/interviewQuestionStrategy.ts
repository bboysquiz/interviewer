import type { InterviewQuestionKind } from './ai/dto.js'

const codeFencePattern = /```[\s\S]*?```/u
const practicalPromptPatterns = [
  /(?:напиш(?:и|ите)|реализу(?:й|йте)|исправ(?:ь|ьте)|отлад(?:ь|ьте)|дополн(?:и|ите)|перепиш(?:и|ите)|созда(?:й|йте)|разработа(?:й|йте)|отрефактор(?:ь|ьте)|проведите\s+(?:рефакторинг|код-ревью)|сделайте\s+(?:рефакторинг|код-ревью)|найдите\s+(?:ошибку|баг)|что\s+(?:вывед(?:ет|ется)|выводится)|какой\s+результат\s+выведет|определите\s+(?:вывод|результат))/iu,
  /как\s+(?:бы\s+)?(?:вы\s+)?(?:реализовали|написали|исправили|отрефакторили)/iu,
  /(?:проанализиру(?:й|йте)|рассмотр(?:и|ите))[\s\S]{0,80}(?:код|функц|программ)/iu,
  /(?:объясни(?:те)?|в\s+ч[её]м)[\s\S]{0,100}(?:ошибк|баг)/iu,
]

export const inferInterviewQuestionKind = (
  prompt: string,
): InterviewQuestionKind =>
  codeFencePattern.test(prompt) ||
  practicalPromptPatterns.some((pattern) => pattern.test(prompt))
    ? 'code_task'
    : 'conceptual'

export const selectInterviewQuestionKind = (
  previousQuestions: string[],
  random: () => number = Math.random,
): InterviewQuestionKind => {
  const recentKinds = previousQuestions
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map(inferInterviewQuestionKind)

  if (recentKinds.length === 2 && recentKinds[0] === recentKinds[1]) {
    return recentKinds[0] === 'code_task' ? 'conceptual' : 'code_task'
  }

  return random() < 0.5 ? 'conceptual' : 'code_task'
}
