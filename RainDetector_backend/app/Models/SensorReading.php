<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SensorReading extends Model
{
    use HasFactory;

    protected $table = 'sensor_readings';

    protected $fillable = [
        'level',
        'value',
        'delta',
        'intensity',
        'muted',
    ];

    protected $casts = [
        'value'     => 'integer',
        'delta'     => 'integer',
        'intensity' => 'integer',
        'muted'     => 'boolean',
    ];
}
