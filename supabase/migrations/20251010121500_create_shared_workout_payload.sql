create or replace function public.fetch_shared_workout_payload(p_workout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  with exercise_data as (
    select
      we.id as workout_exercise_id,
      we.order_index,
      coalesce(ex.name, 'Exercise') as exercise_name,
      ex.id as exercise_id,
      ex.muscle_group,
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'set_no', s.set_no,
          'reps', s.reps,
          'weight', s.weight,
          'unit', s.unit,
          'rpe', s.rpe,
          'rir', s.rir,
          'is_warmup', s.is_warmup
        )
        order by s.set_no
      ) filter (where s.id is not null) as sets_json
    from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    join public.posts p on p.workout_id = w.id
    left join public.exercises ex on ex.id = we.exercise_id
    left join public.sets s on s.workout_exercise_id = we.id
    where we.workout_id = p_workout_id
      and p.show_workout_details = true
    group by we.id, we.order_index, ex.name, ex.muscle_group
  ), summary_data as (
    select
      count(distinct workout_exercise_id) as exercises,
      sum(
        case
          when (set_item->>'is_warmup')::boolean then 0
          else 1
        end
      ) as sets,
      sum(
        case
          when (set_item->>'is_warmup')::boolean then 0
          else coalesce(
            case
              when set_item->>'unit' = 'lb'
                then (set_item->>'weight')::numeric * 0.453592 * coalesce((set_item->>'reps')::numeric, 0)
              else (set_item->>'weight')::numeric * coalesce((set_item->>'reps')::numeric, 0)
            end,
            0
          )
        end
      ) as total_volume
    from exercise_data,
    lateral jsonb_array_elements(coalesce(sets_json, '[]'::jsonb)) as set_item
  )
  select jsonb_build_object(
    'details',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', workout_exercise_id,
            'order_index', order_index,
            'exercise', jsonb_build_object(
              'id', exercise_id,
              'name', exercise_name,
              'muscle_group', muscle_group
            ),
            'sets', coalesce(sets_json, '[]'::jsonb)
          )
          order by order_index
        ),
        '[]'::jsonb
      ),
    'summary',
      coalesce(
        jsonb_build_object(
          'exercises', coalesce(summary_data.exercises, 0),
          'sets', coalesce(summary_data.sets, 0),
          'totalVolume', coalesce(summary_data.total_volume, 0)
        ),
        jsonb_build_object(
          'exercises', 0,
          'sets', 0,
          'totalVolume', 0
        )
      )
  )
  into result
  from exercise_data
  cross join summary_data;

  return coalesce(result, jsonb_build_object(
    'details', '[]'::jsonb,
    'summary', jsonb_build_object(
      'exercises', 0,
      'sets', 0,
      'totalVolume', 0
    )
  ));
end;
$$;

grant execute on function public.fetch_shared_workout_payload(uuid) to authenticated;
