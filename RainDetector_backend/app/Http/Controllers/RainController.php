<?php

namespace App\Http\Controllers;

use App\Models\SensorReading;
use Illuminate\Http\Request;

class RainController extends Controller
{
    // ESP32 calls this (POST /api/rain)
    public function store(Request $request)
    {
        $key = (string) config('services.rain.key');

        if ($key === '' || !hash_equals($key, (string) $request->header('X-API-KEY'))) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        $data = $request->validate([
            'level'     => 'required|in:DRY,LIGHT,HEAVY,STOPPED',
            'value'     => 'required|integer',
            'delta'     => 'required|integer',
            'intensity' => 'required|integer|min:0|max:100',
            'muted'     => 'required|boolean',
        ]);

        SensorReading::create($data);

        return response()->json(['ok' => true], 201);
    }

    // Mobile app calls this (GET /api/rain/latest)
    public function latest()
    {
        $r = SensorReading::latest()->first();

        if (!$r) {
            return response()->json(['online' => false]);
        }

        return response()->json([
            'level'     => $r->level,
            'value'     => $r->value,
            'delta'     => $r->delta,
            'intensity' => $r->intensity,
            'muted'     => $r->muted,
            'updated'   => $r->created_at->toIso8601String(),
            'online'    => $r->created_at->gt(now()->subSeconds(10)),
        ]);
    }
}