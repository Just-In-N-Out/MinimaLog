/**
 * ExerciseDB API Service
 * Handles fetching exercises from self-hosted ExerciseDB API
 */

const EXERCISEDB_BASE_URL = 'https://exercisedb-api-tau.vercel.app/api/v1';
const EXERCISES_PER_PAGE = 10;

export interface ExerciseDbExercise {
  exerciseId: string;
  name: string;
  gifUrl: string;
  targetMuscles: string[];
  bodyParts: string[];
  equipments: string[];
  secondaryMuscles: string[];
  instructions: string[];
}

export interface ExerciseDbResponse {
  data: ExerciseDbExercise[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Fetch a single page of exercises
 */
export async function fetchExercisesPage(page: number = 1): Promise<ExerciseDbResponse> {
  const offset = (page - 1) * EXERCISES_PER_PAGE;
  const url = `${EXERCISEDB_BASE_URL}/exercises?offset=${offset}&limit=${EXERCISES_PER_PAGE}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch exercises: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Fetch ALL exercises from the API (handles pagination automatically)
 * This will make multiple API calls to get all exercises
 */
export async function fetchAllExercises(
  onProgress?: (current: number, total: number) => void
): Promise<ExerciseDbExercise[]> {
  const allExercises: ExerciseDbExercise[] = [];

  // Fetch first page to get total count
  const firstPage = await fetchExercisesPage(1);
  allExercises.push(...firstPage.data);

  const totalPages = firstPage.pagination.totalPages;
  const total = firstPage.pagination.total;

  console.log(`Fetching ${total} exercises across ${totalPages} pages...`);

  if (onProgress) {
    onProgress(firstPage.data.length, total);
  }

  // Fetch remaining pages
  const pagePromises: Promise<ExerciseDbResponse>[] = [];

  for (let page = 2; page <= totalPages; page++) {
    pagePromises.push(fetchExercisesPage(page));
  }

  // Batch requests to avoid overwhelming the API
  const BATCH_SIZE = 5;
  for (let i = 0; i < pagePromises.length; i += BATCH_SIZE) {
    const batch = pagePromises.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch);

    results.forEach(result => {
      allExercises.push(...result.data);
    });

    if (onProgress) {
      onProgress(allExercises.length, total);
    }

    console.log(`Fetched ${allExercises.length}/${total} exercises...`);

    // Small delay between batches to be nice to the API
    if (i + BATCH_SIZE < pagePromises.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`Successfully fetched all ${allExercises.length} exercises!`);

  return allExercises;
}

/**
 * Fetch a specific exercise by ID
 */
export async function fetchExerciseById(exerciseId: string): Promise<ExerciseDbExercise> {
  const url = `${EXERCISEDB_BASE_URL}/exercises/${exerciseId}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch exercise: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Download image from URL and convert to Blob
 */
export async function downloadImage(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  return await response.blob();
}

/**
 * Determine if an exercise supports unilateral tracking based on its properties
 * Uses enhanced name-based pattern matching and liberal equipment detection
 * Liberal approach: flags any exercise that CAN be done unilaterally
 */
export function supportsUnilateral(exercise: ExerciseDbExercise): boolean {
  const name = exercise.name.toLowerCase();

  // Expanded keywords that indicate unilateral exercises
  const unilateralKeywords = [
    // Leg exercises
    'single leg',
    'one leg',
    'pistol',
    'bulgarian split',
    'split squat',
    'lunge',
    'step up',
    'step-up',
    'calf raise',
    'leg curl',
    'leg extension',

    // Arm exercises
    'single arm',
    'one arm',
    'kickback',
    'concentration',
    'lateral raise',
    'hammer curl',
    'tricep extension',

    // General unilateral indicators
    'unilateral',
    'alternating',
    'single',
    'one-',
    'goblet',

    // Specific exercise patterns
    'row', // many rows are unilateral
    'fly', // cable/dumbbell flies often unilateral
    'raise', // lateral/front raises often unilateral
  ];

  // Check if exercise name contains any unilateral keywords
  const hasUnilateralKeyword = unilateralKeywords.some(keyword => name.includes(keyword));

  if (hasUnilateralKeyword) {
    return true;
  }

  // LIBERAL APPROACH: Check equipment + body part combinations
  const equipment = exercise.equipments.map(e => e.toLowerCase());
  const bodyParts = exercise.bodyParts.map(b => b.toLowerCase());

  // Dumbbells are often used unilaterally - flag ALL dumbbell exercises
  const hasDumbbell = equipment.some(e => e.includes('dumbbell'));

  // Cables with single handle - flag cable exercises with arms
  const hasCable = equipment.some(e => e.includes('cable'));

  // Body part detection
  const hasLegs = bodyParts.some(b => b.includes('leg') || b.includes('thigh') || b.includes('calves'));
  const hasArms = bodyParts.some(b => b.includes('arm') || b.includes('shoulder') || b.includes('chest') || b.includes('back'));

  // Liberal: All dumbbell exercises can be done unilaterally
  if (hasDumbbell) {
    return true;
  }

  // Liberal: Cable exercises with arms can be done unilaterally
  if (hasCable && hasArms) {
    return true;
  }

  // Bodyweight exercises with legs (pistol squats, split squats, etc.)
  const isBodyweight = equipment.some(e => e.includes('body weight') || e.includes('bodyweight'));
  if (isBodyweight && hasLegs) {
    return true;
  }

  return false;
}

/**
 * Map ExerciseDB exercise to database format
 */
export function mapExerciseToDb(exercise: ExerciseDbExercise) {
  return {
    exercisedb_id: exercise.exerciseId,
    name: exercise.name,
    equipment: exercise.equipments[0] || null, // Take primary equipment
    muscle_group: exercise.targetMuscles[0] || null, // Take primary target
    body_part: exercise.bodyParts[0] || null, // Take primary body part
    is_bodyweight: exercise.equipments.some(e =>
      e.toLowerCase().includes('body weight') ||
      e.toLowerCase().includes('bodyweight')
    ),
    is_unilateral: supportsUnilateral(exercise),
    image_url: exercise.gifUrl,
    instructions: exercise.instructions,
    secondary_muscles: exercise.secondaryMuscles,
    target_muscles: exercise.targetMuscles,
  };
}
