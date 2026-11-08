<?php

use App\Http\Controllers\RainController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'service' => 'Rain Detector API',
        'timestamp' => now()->toIso8601String(),
    ]);
});

Route::post('/rain', [RainController::class, 'store']);
Route::get('/rain/latest', [RainController::class, 'latest']);
