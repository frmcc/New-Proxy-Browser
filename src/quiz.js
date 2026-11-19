// The mini quiz that goes with each explanation: Gemini writes a few short
// questions for a slide, the student answers them by hand, and Gemini reads
// and checks each answer.

import { generateJson } from './gemini.js';

const QUIZ_SYSTEM = `You write a short quiz that checks whether a university student has understood one lecture slide. The student answers every question by hand in a small box, so each answer must fit in a few words.

Decide how many questions the slide deserves:
- none for a title, agenda, section divider, thank-you or otherwise empty slide,
- one for a slide with a single simple point,
- up to four for a dense slide.
Ask only about what is really important to understand or remember from this slide. Never pad.

Each question:
- tests understanding of an idea on the slide, not the memory of its exact wording,
- has one clear answer that fits in one to six words, a number, a symbol or a short formula,
- is a single question: no "and", no lists, no multiple choice,
- can be answered from this slide and the lecture so far.
Order the questions from the most basic to the most demanding.

Give the reference answer for each question, as short as possible.
Write in the language the slide is written in.`;

const QUIZ_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { question: { type: 'STRING' }, answer: { type: 'STRING' } },
        required: ['question', 'answer'],
      },
    },
  },
  required: ['questions'],
};

const GRADE_SYSTEM = `You check a student's handwritten answer to a quiz question about a lecture slide. The image shows what the student wrote in the answer box.

1. Read the handwriting and put the transcription in "read". Messy handwriting is expected: where a word could be read two ways, prefer the reading that makes sense as an answer to the question.
2. Decide whether the answer is correct by comparing its meaning with the reference answer.
   Correct: the same idea in other words, a synonym, an abbreviation, another language, spelling or grammar mistakes, extra detail that is right, a mathematically equivalent form.
   Not correct: a wrong idea, a contradiction, an answer that misses the essential point, an empty or unreadable box.
3. "feedback" is one short sentence in the language of the question, spoken to the student. If the answer is correct, confirm it in a few words. If it is not, give a hint that points towards the answer without stating it.`;

const GRADE_SCHEMA = {
  type: 'OBJECT',
  properties: { read: { type: 'STRING' }, correct: { type: 'BOOLEAN' }, feedback: { type: 'STRING' } },
  required: ['read', 'correct', 'feedback'],
};

// `parts` is the slide image and lecture text, as built for the explanation.
export async function makeQuiz(settings, parts) {
  const out = await generateJson({
    apiKey: settings.apiKey,
    model: settings.model,
    fast: settings.fast,
    system: QUIZ_SYSTEM,
    parts,
    schema: QUIZ_SCHEMA,
  });
  return (Array.isArray(out?.questions) ? out.questions : [])
    .filter((item) => item?.question && item?.answer)
    .slice(0, 4)
    .map((item) => ({ q: String(item.question).trim(), a: String(item.answer).trim() }));
}

export async function gradeAnswer(settings, { question, answer, image, slideText }) {
  const context = slideText ? `\n\nText of the slide, for context:\n"""\n${slideText.slice(0, 1500)}\n"""` : '';
  const ask = (model) =>
    generateJson({
      apiKey: settings.apiKey,
      model,
      fast: settings.fast,
      system: GRADE_SYSTEM,
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: image } },
        { text: `Question: ${question}\nReference answer: ${answer}${context}\n\nCheck the handwritten answer in the image.` },
      ],
      schema: GRADE_SCHEMA,
    });
  let out;
  try {
    out = await ask(settings.gradeModel);
  } catch (e) {
    // The small grading model is optional; fall back to the main one.
    if (e.status !== 404 || settings.gradeModel === settings.model) throw e;
    out = await ask(settings.model);
  }
  return { read: String(out?.read ?? '').trim(), correct: out?.correct === true, feedback: String(out?.feedback ?? '').trim() };
}
