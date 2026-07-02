const key = 'AIzaSyDGpZtG_UoYwF63JVlkOM0cibVqOiYBwyw';
const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
const d = await r.json();
if (d.models) {
  const genModels = d.models.filter(m => m.supportedGenerationMethods?.includes('generateContent'));
  console.log(`Found ${genModels.length} models supporting generateContent:`);
  genModels.forEach(m => console.log(' -', m.name));
} else {
  console.log('Error:', d.error?.message);
}
